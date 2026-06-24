"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { db } from "@/lib/db";
import {
  campaigns,
  campaignMarkets,
  harvestSearches,
  type CampaignBrief,
} from "@/lib/db/schema";
import { requireUser } from "@/lib/auth-server";
import { searchAvailableNumbers, buyNumber } from "@/lib/dialer/numbers";
import { buildCustomRules } from "@/lib/harvest/rules";
import { runHarvestSearch } from "@/lib/harvest/run";

export type Result<T = unknown> = ({ ok: true } & T) | { ok: false; error: string };

export type AvailableNumber = { phoneNumber: string; friendly: string };

/** Find buyable local numbers for an area code (read-only, no charge). */
export async function searchCityNumbers(
  areaCode: string,
): Promise<Result<{ numbers: AvailableNumber[] }>> {
  await requireUser();
  try {
    return { ok: true, numbers: await searchAvailableNumbers(areaCode) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Number search failed." };
  }
}

export type AddCityPayload = {
  campaignId: string;
  name: string;
  location: string;
  state?: string | null;
  keywords?: string | null;
  areaCodes?: string[];
  // A specific available number to buy (real charge) + attach, or null to skip.
  buyNumber?: { phoneNumber: string; areaCode: string } | null;
  runNow?: boolean;
};

/** Add a city to a campaign: a market + its own scrape search (driven by the
 *  campaign brief) + optional local number, then kick off the first harvest. */
export async function addCity(p: AddCityPayload): Promise<Result<{ id: string }>> {
  const user = await requireUser();
  const name = p.name.trim();
  const location = p.location.trim();
  if (!name) return { ok: false, error: "Name the city." };
  if (!location) return { ok: false, error: 'Enter a search location (e.g. "Austin, TX").' };

  const campaign = await db.query.campaigns.findFirst({ where: eq(campaigns.id, p.campaignId) });
  if (!campaign) return { ok: false, error: "Campaign not found." };
  const brief = (campaign.briefData ?? null) as CampaignBrief | null;
  const state = p.state?.trim() || null;

  // 1) The city (market).
  const [market] = await db
    .insert(campaignMarkets)
    .values({
      campaignId: p.campaignId,
      name,
      location,
      state,
      areaCodes: p.areaCodes ?? [],
      createdBy: user.id,
    })
    .returning({ id: campaignMarkets.id });
  const marketId = market.id;

  // 2) Its scrape search, driven by the campaign's brief (same rules as the
  //    other cities, just a different location).
  const [search] = await db
    .insert(harvestSearches)
    .values({
      label: `${campaign.name} — ${name}`,
      vertical: brief?.vertical || campaign.industry || "general",
      keywords: p.keywords?.trim() || brief?.keywords || null,
      location,
      state,
      targetCampaignId: p.campaignId,
      marketId,
      customRules: (brief ? buildCustomRules(brief) : "") || null,
      active: true,
      createdBy: user.id,
    })
    .returning({ id: harvestSearches.id });

  // 3) Optional: buy + attach the city's local number (REAL charge).
  if (p.buyNumber?.phoneNumber) {
    try {
      await buyNumber({
        phoneNumber: p.buyNumber.phoneNumber,
        areaCode: p.buyNumber.areaCode,
        campaignId: p.campaignId,
        marketId,
        createdBy: user.id,
      });
    } catch {
      /* number purchase is optional — never fail adding the city over it */
    }
  }

  // 4) Kick off the first harvest after responding (so the action returns fast).
  if (p.runNow ?? true) {
    const searchId = search.id;
    after(async () => {
      try {
        await runHarvestSearch(searchId, {
          trigger: "manual",
          maxBusinesses: 8,
          createdBy: user.id,
        });
      } catch {
        /* harvest errors are logged in harvestRuns */
      }
    });
  }

  revalidatePath(`/campaigns/${p.campaignId}/cities`);
  revalidatePath(`/campaigns/${p.campaignId}`);
  revalidatePath(`/campaigns/${p.campaignId}/leads`);
  return { ok: true, id: marketId };
}

/** Soft-hide / restore a city. Keeps its leads + number; just removes it from
 *  the dialer's city picker and pauses its scrape search. */
export async function setCityActive(
  campaignId: string,
  marketId: string,
  active: boolean,
): Promise<Result> {
  await requireUser();
  const now = new Date();
  await db
    .update(campaignMarkets)
    .set({ active, updatedAt: now })
    .where(eq(campaignMarkets.id, marketId));
  // Pause/resume the city's scrape search alongside it.
  await db
    .update(harvestSearches)
    .set({ active, updatedAt: now })
    .where(eq(harvestSearches.marketId, marketId));
  revalidatePath(`/campaigns/${campaignId}/cities`);
  return { ok: true };
}
