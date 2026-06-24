/**
 * Orchestrates one harvest run for a saved search: discover (best available
 * source, resume from cursor, capped for timeout safety) -> classify -> enrich
 * -> ingest -> auto-generate Key Notes for approved leads. Logs a harvestRuns
 * row and advances the cursor so repeated runs sweep further (wrapping when
 * exhausted to re-check for new businesses).
 *
 * Backs all three triggers: the admin button, the Vercel cron, and
 * `pnpm leads:harvest`.
 */
import { eq } from "drizzle-orm";
import { db } from "../db";
import { harvestSearches, harvestRuns, leads, type HarvestStats } from "../db/schema";
import { discover } from "./sources";
import { classifyByRules, classifyReviewWithContext } from "./classify";
import { enrichAll } from "./enrich";
import { ingestCandidates } from "./ingest";
import { generateKeyNotes } from "../ai/key-notes";
import { isAnthropicConfigured } from "../ai/client";
import type { Enriched, RunOptions } from "./types";

/** Run async work over items with bounded concurrency. */
async function mapLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) await fn(items[cursor++]);
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length || 1) }, worker));
}

export async function runHarvestSearch(
  searchId: string,
  opts: RunOptions,
): Promise<HarvestStats> {
  const search = await db.query.harvestSearches.findFirst({
    where: eq(harvestSearches.id, searchId),
  });
  if (!search) throw new Error(`Harvest search ${searchId} not found`);

  const max = Math.max(1, opts.maxBusinesses ?? search.maxPerRun ?? 30);

  // 1) Discover (best available source) up to `max`, resuming from the cursor.
  const { candidates, errors, sourceName, nextCursor } = await discover(search, { max });
  const sliced = candidates.slice(0, max);

  // 2) Rules-only classification (free, fast). Rejects skip enrichment.
  const ruled = sliced.map((c) => classifyByRules(c, search));

  // 3) Enrich keepers (website/hours/email/social/decision-maker + verify).
  let enriched: Enriched[] = await enrichAll(ruled);

  // 4) Re-judge the ambiguous middle with Haiku using the SCRAPED WEBSITE TEXT
  // (not just the business name), applying the search's NL rules.
  enriched = await classifyReviewWithContext(enriched, search);

  // requireWebsite is enforced here — website discovery has now run.
  if (search.requireWebsite) {
    enriched = enriched.map((e) =>
      e.verdict !== "reject" && !e.website
        ? { ...e, verdict: "reject", reason: "No website found" }
        : e,
    );
  }

  // 5) Ingest (dedup + route + insert + events + campaign link).
  const { counters, inserted } = await ingestCandidates(enriched, search);

  // 6) Auto Key Notes for newly-approved (dialable) leads.
  if (isAnthropicConfigured()) {
    const approved = inserted.filter((x) => x.item.verdict === "approve");
    await mapLimit(approved, 3, async ({ leadId, item }) => {
      const cf: Record<string, string> = {};
      const cityState = [item.city, item.state].filter(Boolean).join(", ");
      if (cityState) cf.City = cityState;
      if (item.address) cf.Address = item.address;
      if (item.categories.length) cf.Categories = item.categories.join(", ");
      const notes = await generateKeyNotes({
        companyName: item.companyName,
        contactName: null,
        title: null,
        website: item.website,
        city: cityState || null,
        customFields: cf,
        enrichment: item.enrichment,
        notes: [],
        websiteText: item.websiteText,
        vertical: search.vertical,
        reviews: item.reviews,
      });
      if (notes) {
        await db.update(leads).set({ keyNotes: notes }).where(eq(leads.id, leadId));
      }
    });
  }

  const stats: HarvestStats = {
    found: sliced.length,
    newCount: counters.newCount,
    dupes: counters.dupes,
    rejected: counters.rejected,
    queued: counters.queued,
    approved: counters.approved,
    errors: errors.length ? errors : undefined,
    at: new Date().toISOString(),
  };

  await db.insert(harvestRuns).values({
    searchId,
    trigger: opts.trigger,
    found: stats.found ?? 0,
    newCount: stats.newCount ?? 0,
    dupes: stats.dupes ?? 0,
    rejected: stats.rejected ?? 0,
    queued: stats.queued ?? 0,
    approved: stats.approved ?? 0,
    errors,
    finishedAt: new Date(),
  });

  await db
    .update(harvestSearches)
    .set({
      cursor: nextCursor,
      lastRunAt: new Date(),
      lastStats: { ...stats, source: sourceName } as HarvestStats,
      updatedAt: new Date(),
    })
    .where(eq(harvestSearches.id, searchId));

  return stats;
}
