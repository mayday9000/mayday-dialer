/**
 * Turns classified+enriched candidates into leads. Mirrors the CSV importer
 * (app/(app)/leads/import/actions.ts): in-file dedup -> DB dedup by normalized
 * phone -> chunked insert with onConflictDoNothing on the phone unique index ->
 * leadEvents audit trail -> campaign link. Adds verdict routing + a fuzzy
 * name/address fallback for phone-less candidates.
 */
import { db } from "../db";
import { leads, leadEvents, campaignLeads } from "../db/schema";
import { normalizePhone } from "../phone";
import { findFuzzyMatch, normalizeDomain, type FuzzyTarget } from "./match";
import type { Enriched, HarvestSearch, Verdict } from "./types";

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export type IngestCounters = {
  newCount: number;
  dupes: number;
  rejected: number;
  queued: number;
  approved: number;
};

type Prepared = { item: Enriched; normalized: string | null; domain: string | null };

/** status/reviewState/archived for each verdict. */
function routeFor(verdict: Verdict): {
  reviewState: "approved" | "pending" | "rejected";
  archived: boolean;
} {
  if (verdict === "approve") return { reviewState: "approved", archived: false };
  if (verdict === "review") return { reviewState: "pending", archived: false };
  return { reviewState: "rejected", archived: true };
}

function draftFor(
  item: Enriched,
  normalized: string | null,
  search: HarvestSearch,
): typeof leads.$inferInsert {
  const route = routeFor(item.verdict);
  // Source facts kept in customFields for at-a-glance context. City is
  // "City, ST" so lib/compliance.leadTimezone can resolve the timezone.
  const customFields: Record<string, string> = {};
  const cityState = [item.city, item.state].filter(Boolean).join(", ");
  if (cityState) customFields.City = cityState;
  if (item.address) customFields.Address = item.address;
  if (item.rating != null) {
    customFields.Rating =
      item.reviewCount != null ? `${item.rating} (${item.reviewCount} reviews)` : String(item.rating);
  }
  if (item.categories.length) customFields.Categories = item.categories.join(", ");
  if (item.source.url) customFields["Source URL"] = item.source.url;
  customFields["Harvest Search"] = search.label;

  return {
    companyName: item.companyName || null,
    // Decision-maker + email extracted during enrichment populate the lead so
    // the Book dialog can prefill an invite.
    contactName: item.enrichment?.dmName?.value || null,
    title: item.enrichment?.dmTitle?.value || null,
    email: item.enrichment?.email?.value || null,
    phone: item.phoneRaw || null,
    phoneNormalized: normalized,
    website: item.website || null,
    status: "new",
    reviewState: route.reviewState,
    archived: route.archived,
    archivedReason: item.verdict === "reject" ? item.reason : null,
    customFields,
    enrichment: item.enrichment ?? {},
    reviews: item.reviews ?? [],
    source: `harvest:${item.source.name}`,
    createdBy: search.createdBy ?? null,
  };
}

export type IngestResult = {
  counters: IngestCounters;
  inserted: { leadId: string; item: Enriched }[];
};

export async function ingestCandidates(
  items: Enriched[],
  search: HarvestSearch,
): Promise<IngestResult> {
  const counters: IngestCounters = { newCount: 0, dupes: 0, rejected: 0, queued: 0, approved: 0 };
  if (!items.length) return { counters, inserted: [] };

  const prepared: Prepared[] = items.map((item) => ({
    item,
    normalized: normalizePhone(item.phoneRaw),
    domain: normalizeDomain(item.website),
  }));

  // In-batch dedup by phone AND website domain — two Yelp listings for one
  // office (e.g. "Example PM" + "Example PM Management", same site) are
  // collapsed before we ever insert.
  const seenPhone = new Set<string>();
  const seenDomain = new Set<string>();
  const deduped: Prepared[] = [];
  for (const p of prepared) {
    if (p.normalized && seenPhone.has(p.normalized)) {
      counters.dupes++;
      continue;
    }
    if (p.domain && seenDomain.has(p.domain)) {
      counters.dupes++;
      continue;
    }
    if (p.normalized) seenPhone.add(p.normalized);
    if (p.domain) seenDomain.add(p.domain);
    deduped.push(p);
  }

  // One scan of existing leads powers all three DB-side dedup checks: phone,
  // website domain, and fuzzy name/address. Full scan is fine at this scale.
  const existingRows = await db
    .select({
      id: leads.id,
      companyName: leads.companyName,
      phoneNormalized: leads.phoneNormalized,
      website: leads.website,
      customFields: leads.customFields,
    })
    .from(leads);
  const existingPhones = new Set<string>();
  const domainToLead = new Map<string, string>();
  const fuzzyTargets: FuzzyTarget[] = [];
  for (const r of existingRows) {
    if (r.phoneNormalized) existingPhones.add(r.phoneNormalized);
    const d = normalizeDomain(r.website);
    if (d && !domainToLead.has(d)) domainToLead.set(d, r.id);
    const cf = (r.customFields as Record<string, string> | null) ?? {};
    fuzzyTargets.push({ id: r.id, companyName: r.companyName, city: cf.City ?? null, address: cf.Address ?? null });
  }

  const domainMatches: { candidate: string; existingId: string; domain: string }[] = [];
  const fuzzyMatches: { candidate: string; existingId: string }[] = [];

  const toInsert: Prepared[] = [];
  for (const p of deduped) {
    // 1) Same phone → duplicate.
    if (p.normalized && existingPhones.has(p.normalized)) {
      counters.dupes++;
      continue;
    }
    // 2) Same website domain → duplicate (even if the phone differs).
    if (p.domain) {
      const existingId = domainToLead.get(p.domain);
      if (existingId) {
        counters.dupes++;
        domainMatches.push({ candidate: p.item.companyName, existingId, domain: p.domain });
        continue;
      }
    }
    // 3) Fuzzy name/address (now for every candidate, not just phone-less) →
    //    catches "X" vs "X Management" in the same city without a shared site.
    if (p.item.companyName) {
      const match = findFuzzyMatch(
        { companyName: p.item.companyName, city: p.item.city, address: p.item.address },
        fuzzyTargets,
      );
      if (match) {
        counters.dupes++;
        fuzzyMatches.push({ candidate: p.item.companyName, existingId: match });
        continue;
      }
    }
    toInsert.push(p);
  }

  // Log skipped duplicates so every merge is auditable/reversible.
  if (domainMatches.length) {
    await db.insert(leadEvents).values(
      domainMatches.map((m) => ({
        leadId: m.existingId,
        type: "system" as const,
        body: `Harvest matched a candidate "${m.candidate}" to this lead by website (${m.domain}) — skipped as duplicate.`,
        metadata: { source: "harvest", kind: "domain_dupe", domain: m.domain },
      })),
    );
  }
  if (fuzzyMatches.length) {
    await db.insert(leadEvents).values(
      fuzzyMatches.map((m) => ({
        leadId: m.existingId,
        type: "system" as const,
        body: `Harvest fuzzy-matched a candidate "${m.candidate}" to this lead by name — skipped as duplicate.`,
        metadata: { source: "harvest", kind: "fuzzy_dupe" },
      })),
    );
  }

  // Build a phone -> draft map so we can correlate inserted rows back to their
  // verdict/reason (onConflictDoNothing only returns actually-inserted rows).
  const phonedDrafts = toInsert.filter((p) => p.normalized);
  const phonelessDrafts = toInsert.filter((p) => !p.normalized);

  const byPhone = new Map<string, Prepared>();
  for (const p of phonedDrafts) byPhone.set(p.normalized as string, p);

  const inserted: { leadId: string; item: Enriched }[] = [];

  // Phoned: bulk insert, correlate via returned phoneNormalized.
  for (const part of chunk(phonedDrafts, 200)) {
    const rows = await db
      .insert(leads)
      .values(part.map((p) => draftFor(p.item, p.normalized, search)))
      .onConflictDoNothing({ target: leads.phoneNormalized })
      .returning({ id: leads.id, p: leads.phoneNormalized });
    for (const r of rows) {
      const prep = r.p ? byPhone.get(r.p) : undefined;
      if (prep) inserted.push({ leadId: r.id, item: prep.item });
    }
  }

  // Phone-less: insert individually so each id correlates directly.
  for (const p of phonelessDrafts) {
    const [row] = await db
      .insert(leads)
      .values(draftFor(p.item, null, search))
      .returning({ id: leads.id });
    if (row) inserted.push({ leadId: row.id, item: p.item });
  }

  // Audit events + per-verdict counters + campaign links.
  const events: (typeof leadEvents.$inferInsert)[] = [];
  const campaignLinks: string[] = [];
  for (const { leadId, item } of inserted) {
    counters.newCount++;
    if (item.verdict === "approve") counters.approved++;
    else if (item.verdict === "review") counters.queued++;
    else counters.rejected++;

    if (item.verdict === "reject") {
      events.push({
        leadId,
        type: "system",
        body: `Auto-rejected by harvest: ${item.reason}`,
        metadata: { source: "harvest", verdict: item.verdict },
      });
    } else {
      events.push({
        leadId,
        type: "import",
        body: `Harvested from ${item.source.name} (${search.label}) — ${item.reason}`,
        metadata: { source: "harvest", verdict: item.verdict, confidence: item.confidence },
      });
      campaignLinks.push(leadId);
    }
  }
  if (events.length) await db.insert(leadEvents).values(events);

  // Link approved + review leads (not rejects) to the target campaign.
  if (search.targetCampaignId && campaignLinks.length) {
    await db
      .insert(campaignLeads)
      .values(campaignLinks.map((leadId) => ({ campaignId: search.targetCampaignId as string, leadId })))
      .onConflictDoNothing();
  }

  return { counters, inserted };
}
