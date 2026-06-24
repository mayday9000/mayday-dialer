/**
 * Scheduled auto-top-up. For each active "on_low" lead source whose target
 * campaign has dropped below its minDialable threshold, run a small harvest so
 * the dial queue never empties. Protected by CRON_SECRET (Vercel cron sends it
 * automatically as a Bearer token; also usable via manual curl).
 *
 * Capped per invocation to stay within the Vercel function timeout.
 */
import { NextResponse } from "next/server";
import { and, eq, inArray, isNull, notInArray, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { harvestSearches, campaignLeads, leads } from "@/lib/db/schema";
import { DIALABLE_STATUSES } from "@/lib/dial";
import { runHarvestSearch } from "@/lib/harvest/run";

export const runtime = "nodejs";
export const maxDuration = 60; // Hobby cap; raise on Pro

// Per-tick cap to stay within the function timeout. A multi-city campaign has
// one search per city, so its cities refill across successive cron ticks rather
// than all at once — fine for keeping queues topped up.
const MAX_SEARCHES_PER_RUN = 2;
const CRON_MAX_BUSINESSES = 15;

// Dialable leads for a campaign — scoped to one city when the search feeds a
// market. Without the market scope a multi-city campaign would compute its
// campaign-wide total, so an empty city would never trigger a top-up.
async function dialableCount(campaignId: string, marketId: string | null): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(campaignLeads)
    .innerJoin(leads, eq(leads.id, campaignLeads.leadId))
    .where(
      and(
        eq(campaignLeads.campaignId, campaignId),
        marketId ? eq(campaignLeads.marketId, marketId) : undefined,
        eq(leads.archived, false),
        inArray(leads.status, DIALABLE_STATUSES),
        or(isNull(leads.reviewState), notInArray(leads.reviewState, ["pending", "rejected"])),
      ),
    );
  return row?.count ?? 0;
}

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 501 });
  }
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const searches = await db
    .select()
    .from(harvestSearches)
    .where(eq(harvestSearches.active, true));

  const ran: Record<string, unknown>[] = [];
  const skipped: Record<string, unknown>[] = [];

  for (const s of searches) {
    if (ran.length >= MAX_SEARCHES_PER_RUN) break;
    if (!s.targetCampaignId) {
      skipped.push({ label: s.label, why: "no target campaign" });
      continue;
    }
    if (s.cadence !== "on_low") {
      skipped.push({ label: s.label, why: `cadence ${s.cadence}` });
      continue;
    }
    const count = await dialableCount(s.targetCampaignId, s.marketId);
    if (count >= s.minDialable) {
      skipped.push({ label: s.label, why: `above threshold (${count}/${s.minDialable})` });
      continue;
    }
    try {
      const stats = await runHarvestSearch(s.id, {
        trigger: "cron",
        maxBusinesses: CRON_MAX_BUSINESSES,
      });
      ran.push({ label: s.label, before: count, stats });
    } catch (e) {
      ran.push({ label: s.label, error: e instanceof Error ? e.message : String(e) });
    }
  }

  return NextResponse.json({ ok: true, ran, skipped });
}
