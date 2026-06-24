/**
 * Manual / local harvest runner.
 *
 *   pnpm leads:harvest --search=<id>
 *   pnpm leads:harvest --location="Springfield, IL" --state=IL --label="Springfield PM" --campaign=<id> [--max=30] [--reset]
 *
 * With --search it runs an existing saved search. Otherwise it find-or-creates a
 * search by --label and runs it. --reset clears the pagination cursor first
 * (re-sweep from the top — useful for verifying dedup).
 */
import { eq } from "drizzle-orm";
import { db } from "../lib/db";
import { harvestSearches } from "../lib/db/schema";
import { runHarvestSearch } from "../lib/harvest/run";

function arg(name: string): string | undefined {
  const pref = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(pref));
  if (hit) return hit.slice(pref.length);
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0) {
    const next = process.argv[i + 1];
    if (next && !next.startsWith("--")) return next;
  }
  return undefined;
}

function flag(name: string): boolean {
  return process.argv.includes(`--${name}`) || arg(name) !== undefined;
}

async function main() {
  let searchId = arg("search");

  if (!searchId) {
    const label = arg("label") ?? "Ad-hoc harvest";
    const location = arg("location") ?? arg("city");
    if (!location) {
      throw new Error('Provide --search=<id> or --location="City, ST"');
    }
    const existing = await db.query.harvestSearches.findFirst({
      where: eq(harvestSearches.label, label),
    });
    if (existing) {
      searchId = existing.id;
    } else {
      const max = arg("max");
      const [row] = await db
        .insert(harvestSearches)
        .values({
          label,
          location,
          state: arg("state") ?? null,
          keywords: arg("keywords") ?? null,
          targetCampaignId: arg("campaign") ?? null,
          maxPerRun: max ? Number(max) : 30,
        })
        .returning({ id: harvestSearches.id });
      searchId = row.id;
      console.log(`Created harvest search "${label}" (${searchId})`);
    }
  }

  if (flag("reset")) {
    await db.update(harvestSearches).set({ cursor: {} }).where(eq(harvestSearches.id, searchId));
    console.log("Cursor reset.");
  }

  const maxArg = arg("max");
  const stats = await runHarvestSearch(searchId, {
    trigger: "script",
    maxBusinesses: maxArg ? Number(maxArg) : undefined,
  });

  console.log("Harvest complete:");
  console.log(JSON.stringify(stats, null, 2));
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
