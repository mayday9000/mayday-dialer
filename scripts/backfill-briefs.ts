/**
 * Backfill: write a rich caller brief (the study sheet on the campaign overview)
 * for existing campaigns. Pulls from each campaign's structured brief + meta and
 * saves markdown to campaigns.brief plus structured pain points / objections.
 *
 *   pnpm exec dotenv -e .env -- tsx scripts/backfill-briefs.ts [--all] [--limit=50]
 *
 * Default: campaigns with no brief, or a thin one (< 200 chars).
 * --all = regenerate every campaign's brief.
 *
 * Needs ANTHROPIC_API_KEY. Writes to whatever DATABASE_URL points at, so run it
 * deliberately.
 */
import { eq } from "drizzle-orm";
import { db } from "../lib/db";
import { campaigns, type CampaignBrief } from "../lib/db/schema";
import { generateCallerBrief, callerBriefToMarkdown } from "../lib/ai/caller-brief";
import { isAnthropicConfigured } from "../lib/ai/client";

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit?.split("=")[1];
}
const ALL = process.argv.includes("--all");
const LIMIT = Number(arg("limit") ?? "50");
const THIN = 200; // chars — below this a brief is "lacking"

async function main() {
  if (!isAnthropicConfigured()) {
    console.error("ANTHROPIC_API_KEY is not set — nothing to do.");
    process.exit(1);
  }

  const rows = await db.select().from(campaigns).orderBy(campaigns.createdAt);
  const targets = rows.filter((c) => ALL || !c.brief || c.brief.trim().length < THIN);

  console.log(`${rows.length} campaigns; ${targets.length} need a brief${ALL ? " (--all)" : ""}.`);
  let done = 0;
  let failed = 0;

  for (const c of targets.slice(0, LIMIT)) {
    process.stdout.write(`• ${c.name} … `);
    const result = await generateCallerBrief({
      name: c.name,
      description: c.description,
      industry: c.industry,
      location: c.location,
      existingBrief: c.brief,
      brief: c.briefData,
    });
    if (!result) {
      failed++;
      console.log("skipped (no AI output)");
      continue;
    }
    const markdown = callerBriefToMarkdown(result);
    const briefData: CampaignBrief | null = c.briefData
      ? { ...c.briefData, painPoints: result.painPoints, objections: result.objections }
      : null;
    await db
      .update(campaigns)
      .set({ brief: markdown, ...(briefData ? { briefData } : {}), updatedAt: new Date() })
      .where(eq(campaigns.id, c.id));
    done++;
    console.log(`done (${markdown.length} chars, ${result.objections.length} objections)`);
  }

  console.log(`\nWrote ${done} brief(s), ${failed} skipped.`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
