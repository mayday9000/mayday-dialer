/**
 * One-off: re-judge harvested leads stuck in the review queue using the new
 * website-aware classifier. Re-scrapes each site (so Haiku sees real content,
 * not just the name), re-extracts the contact, refreshes Key Notes, and:
 *   approve -> reviewState "approved" (dialable)
 *   reject  -> reviewState "rejected" + archived
 *   review  -> stays pending
 *
 *   pnpm exec dotenv -e .env -- tsx scripts/reclassify-pending.ts
 */
import { and, eq, like } from "drizzle-orm";
import { db } from "../lib/db";
import { leads, harvestSearches } from "../lib/db/schema";
import { enrichCandidate } from "../lib/harvest/enrich";
import { verifyEnrichment } from "../lib/harvest/verify";
import { classifyReviewWithContext } from "../lib/harvest/classify";
import { generateKeyNotes } from "../lib/ai/key-notes";
import type { Enriched, HarvestSearch } from "../lib/harvest/types";

const CONCURRENCY = 2;

async function main() {
  const pending = await db
    .select()
    .from(leads)
    .where(and(eq(leads.reviewState, "pending"), like(leads.source, "harvest:%")));

  const searches = await db.select().from(harvestSearches);
  const byLabel = new Map(searches.map((s) => [s.label, s]));

  console.log(`Re-judging ${pending.length} pending lead(s) with website content…`);
  const tally = { approved: 0, rejected: 0, stillReview: 0 };
  let cursor = 0;

  async function worker() {
    while (cursor < pending.length) {
      const lead = pending[cursor++];
      const cf = (lead.customFields as Record<string, string> | null) ?? {};
      const existing = lead.enrichment ?? {};
      const srcName = (lead.source ?? "harvest:unknown").replace(/^harvest:/, "") || "unknown";
      const search =
        byLabel.get(cf["Harvest Search"] ?? "") ?? ({ customRules: null } as unknown as HarvestSearch);

      try {
        const { enrichment: fresh, website, websiteText } = await enrichCandidate({
          companyName: lead.companyName ?? "",
          city: cf.City ?? null,
          website: lead.website,
          hoursText: existing.officeHours?.value ?? null,
          address: existing.address?.value ?? null,
          source: { name: srcName, url: cf["Source URL"] ?? null },
        });
        const merged = verifyEnrichment({ ...existing, ...fresh });

        const item: Enriched = {
          companyName: lead.companyName ?? "",
          phoneRaw: lead.phone,
          website: website ?? lead.website,
          hoursText: existing.officeHours?.value ?? null,
          periods: existing.officeHours?.periods ?? null,
          address: cf.Address ?? null,
          city: (cf.City ?? "").split(",")[0]?.trim() || null,
          state: ((cf.City ?? "").split(",")[1] ?? "").trim() || null,
          zip: null,
          categories: (cf.Categories ?? "").split(",").map((s) => s.trim()).filter(Boolean),
          rating: null,
          reviewCount: null,
          reviews: lead.reviews ?? [],
          source: { name: srcName, url: cf["Source URL"] ?? null },
          verdict: "review",
          reason: lead.archivedReason ?? "",
          confidence: 0.4,
          enrichment: merged,
          websiteText,
        };

        const [judged] = await classifyReviewWithContext([item], search);
        const contactName = fresh.dmName?.value ?? lead.contactName ?? null;
        const title = fresh.dmTitle?.value ?? lead.title ?? null;

        const reviewState =
          judged.verdict === "approve" ? "approved" : judged.verdict === "reject" ? "rejected" : "pending";
        const archived = judged.verdict === "reject";

        const notes = await generateKeyNotes({
          companyName: lead.companyName,
          contactName,
          title,
          website: website ?? lead.website,
          city: cf.City ?? null,
          customFields: cf,
          enrichment: merged,
          notes: [],
          websiteText,
          reviews: lead.reviews,
        });

        await db
          .update(leads)
          .set({
            reviewState,
            archived,
            archivedReason: archived ? judged.reason : lead.archivedReason,
            contactName,
            title,
            email: lead.email || merged.email?.value || null,
            website: lead.website ?? website,
            enrichment: merged,
            ...(notes ? { keyNotes: notes } : {}),
            updatedAt: new Date(),
          })
          .where(eq(leads.id, lead.id));

        if (reviewState === "approved") tally.approved++;
        else if (reviewState === "rejected") tally.rejected++;
        else tally.stillReview++;

        console.log(`  ${lead.companyName}: ${judged.verdict} — ${judged.reason}`);
      } catch (e) {
        console.log(`  ${lead.companyName}: error ${e instanceof Error ? e.message : e}`);
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, pending.length || 1) }, worker));
  console.log(`Done. approved ${tally.approved}, rejected ${tally.rejected}, still review ${tally.stillReview}.`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
