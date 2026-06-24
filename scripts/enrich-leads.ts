/**
 * Backfill: enrich leads (ANY source — CSV imports included). Looks up real
 * office hours + website/rating via Google Places, scrapes the site for the
 * decision-maker (Haiku) + email/social, writes contactName/title/email, merges
 * enrichment, and regenerates Key Notes.
 *
 *   pnpm exec dotenv -e .env -- tsx scripts/enrich-leads.ts [--all] [--limit=200]
 *
 * Default: non-archived leads missing a contact OR office hours.
 * --all = every non-archived lead (re-enrich).
 */
import { and, eq, isNull, or } from "drizzle-orm";
import { db } from "../lib/db";
import { leads } from "../lib/db/schema";
import { enrichCandidate } from "../lib/harvest/enrich";
import { verifyEnrichment } from "../lib/harvest/verify";
import { generateKeyNotes } from "../lib/ai/key-notes";

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}
const ALL = process.argv.includes("--all");
const LIMIT = Number(arg("limit") ?? 200);
const CONCURRENCY = 3;

async function main() {
  const rows = await db
    .select()
    .from(leads)
    .where(
      and(
        eq(leads.archived, false),
        // Default: leads that still need a contact or hours. --all: everyone.
        ALL ? undefined : or(isNull(leads.contactName), isNull(leads.email)),
      ),
    )
    .limit(LIMIT);

  console.log(`Enriching ${rows.length} lead(s)…`);
  let withContact = 0;
  let cursor = 0;

  async function worker() {
    while (cursor < rows.length) {
      const lead = rows[cursor++];
      const cf = (lead.customFields as Record<string, string> | null) ?? {};
      const existing = lead.enrichment ?? {};
      const sourceName = (lead.source ?? "").startsWith("harvest:")
        ? lead.source!.replace(/^harvest:/, "")
        : "import";

      try {
        // No hoursText passed → enrichCandidate does a fresh Places lookup for
        // real hours + structured periods (so open-now works).
        const { enrichment: fresh, website, websiteText } = await enrichCandidate({
          companyName: lead.companyName ?? "",
          city: cf.City ?? null,
          website: lead.website,
          address: existing.address?.value ?? null,
          source: { name: sourceName, url: cf["Source URL"] ?? null },
        });

        const merged = verifyEnrichment({ ...existing, ...fresh });
        const contactName = fresh.dmName?.value ?? lead.contactName ?? null;
        const title = fresh.dmTitle?.value ?? lead.title ?? null;
        if (fresh.dmName?.value) withContact++;

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
        });

        await db
          .update(leads)
          .set({
            contactName,
            title,
            email: lead.email || merged.email?.value || null,
            website: lead.website ?? website,
            enrichment: merged,
            ...(notes ? { keyNotes: notes } : {}),
            updatedAt: new Date(),
          })
          .where(eq(leads.id, lead.id));

        console.log(`  ${lead.companyName ?? lead.id}: ${fresh.dmName?.value ? `→ ${fresh.dmName.value}` : "no contact found"}`);
      } catch (e) {
        console.log(`  ${lead.companyName ?? lead.id}: error ${e instanceof Error ? e.message : e}`);
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, rows.length || 1) }, worker));
  console.log(`Done. Found a contact for ${withContact}/${rows.length}.`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
