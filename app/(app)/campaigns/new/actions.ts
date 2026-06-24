"use server";

import { desc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import {
  campaigns,
  campaignMarkets,
  harvestSearches,
  scripts,
  type CampaignBrief,
  type CampaignGoalType,
} from "@/lib/db/schema";
import { requireUser } from "@/lib/auth-server";
import { draftCampaignBrief } from "@/lib/ai/campaign-architect";
import { strengthenOffer, type OfferVariant } from "@/lib/ai/offer";
import { generateScript } from "@/lib/ai/script";
import { placesSearch } from "@/lib/harvest/sources/places";
import { runHarvestSearch } from "@/lib/harvest/run";
import { searchAvailableNumbers, buyNumber } from "@/lib/dialer/numbers";
import { buildCustomRules } from "@/lib/harvest/rules";
import { after } from "next/server";

export type Result<T = unknown> = ({ ok: true } & T) | { ok: false; error: string };

/** Step 0: one-line idea → a structured, researched brief draft. */
export async function architectCampaign(
  prompt: string,
  goalType?: CampaignGoalType,
): Promise<Result<{ brief: CampaignBrief; name: string }>> {
  await requireUser();
  if (!prompt.trim()) return { ok: false, error: "Describe the campaign first." };
  const brief = await draftCampaignBrief({ prompt, goalType });
  if (!brief) return { ok: false, error: "AI is unavailable — fill the fields in manually." };
  const name = (brief as CampaignBrief & { name?: string }).name?.trim() || brief.vertical;
  return { ok: true, brief, name };
}

/** Step: sharpen a (possibly weak) offer into a few stronger variants. */
export async function strengthenOfferAction(
  brief: CampaignBrief,
  currentOffer: string,
): Promise<Result<{ variants: OfferVariant[] }>> {
  await requireUser();
  const variants = await strengthenOffer({ brief, currentOffer });
  if (!variants?.length) return { ok: false, error: "Couldn't draft offers right now." };
  return { ok: true, variants };
}

/** Step: generate a script from the brief + offer, in the house style. */
export async function generateScriptAction(
  brief: CampaignBrief,
  offer: string,
): Promise<Result<{ markdown: string }>> {
  await requireUser();
  // Seed the house style from the most recent existing script.
  const [sample] = await db
    .select({ md: scripts.contentMarkdown })
    .from(scripts)
    .orderBy(desc(scripts.updatedAt))
    .limit(1);
  const markdown = await generateScript({ brief, offer, styleSample: sample?.md ?? null });
  if (!markdown) return { ok: false, error: "Couldn't generate a script right now." };
  return { ok: true, markdown };
}

export type PreviewLead = { name: string; address: string | null; website: string | null; phone: string | null };

/** Step: a quick, cheap sample of who the scraper will find (Places only). */
export async function previewLeads(
  keywords: string,
  geography: string,
): Promise<Result<{ leads: PreviewLead[] }>> {
  await requireUser();
  const q = `${keywords} in ${geography}`.trim();
  try {
    const { candidates } = await placesSearch({ textQuery: q });
    const leads = candidates.slice(0, 8).map((c) => ({
      name: c.companyName,
      address: c.address,
      website: c.website,
      phone: c.phoneRaw,
    }));
    return { ok: true, leads };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Lead preview failed." };
  }
}

export type AvailableNumber = { phoneNumber: string; friendly: string };

/** Step: find buyable local numbers for an area code (read-only, no charge). */
export async function searchNumbers(areaCode: string): Promise<Result<{ numbers: AvailableNumber[] }>> {
  await requireUser();
  try {
    const numbers = await searchAvailableNumbers(areaCode);
    return { ok: true, numbers };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Number search failed." };
  }
}

export type LaunchPayload = {
  name: string;
  brief: CampaignBrief;
  offer: string;
  description?: string;
  scriptMarkdown?: string | null;
  scraper: {
    keywords: string;
    location: string;
    extraAreas: string[];
    radiusMiles?: number | null;
    requireWebsite: boolean;
    requirePhone: boolean;
    minRating?: number | null;
    minReviews?: number | null;
  };
  // A specific available number to buy (real charge) + attach, or null to skip.
  buyNumber?: { phoneNumber: string; areaCode: string } | null;
  runNow: boolean;
};

/** Create the whole campaign: record + brief + script + scraper + (optional)
 *  local number, then kick off the first harvest. */
export async function launchCampaign(p: LaunchPayload): Promise<Result<{ id: string }>> {
  const user = await requireUser();
  if (!p.name.trim()) return { ok: false, error: "Name the campaign." };

  const brief: CampaignBrief = { ...p.brief, offer: p.offer.trim() || p.brief.offer };

  // 1) Campaign record (with the structured brief).
  const [camp] = await db
    .insert(campaigns)
    .values({
      name: p.name.trim(),
      description: p.description?.trim() || brief.goal || null,
      location: brief.geography || null,
      industry: brief.vertical || null,
      briefData: brief,
      meetingDurationMin: brief.goalType === "meeting" ? 15 : 30,
      createdBy: user.id,
    })
    .returning({ id: campaigns.id });
  const campaignId = camp.id;

  // 1b) Default city (market). The campaign launches as a single city; more can
  //     be added later. Its scrape search + local number attach to this market.
  const [market] = await db
    .insert(campaignMarkets)
    .values({
      campaignId,
      name: (p.scraper.location || brief.geography || "All").trim() || "All",
      location: p.scraper.location || brief.geography || null,
      areaCodes: brief.areaCodes ?? [],
      isDefault: true,
      createdBy: user.id,
    })
    .returning({ id: campaignMarkets.id });
  const marketId = market.id;

  // 2) Script (becomes the campaign's primary automatically).
  if (p.scriptMarkdown?.trim()) {
    const [s] = await db
      .insert(scripts)
      .values({
        name: `${p.name.trim()} — Script`,
        contentMarkdown: p.scriptMarkdown,
        campaignId,
        createdBy: user.id,
      })
      .returning({ id: scripts.id });
    await db.update(campaigns).set({ scriptId: s.id }).where(eq(campaigns.id, campaignId));
  }

  // 3) Lead scraper (active), driven by the brief.
  const radiusMeters = p.scraper.radiusMiles ? Math.round(p.scraper.radiusMiles * 1609) : 40000;
  const [search] = await db
    .insert(harvestSearches)
    .values({
      label: p.name.trim(),
      vertical: brief.vertical || "general",
      keywords: p.scraper.keywords || brief.keywords || null,
      location: p.scraper.location || brief.geography,
      radiusMeters,
      extraLocations: p.scraper.extraAreas ?? [],
      targetCampaignId: campaignId,
      marketId,
      requireWebsite: p.scraper.requireWebsite,
      requirePhone: p.scraper.requirePhone,
      minRating: p.scraper.minRating ?? null,
      minReviews: p.scraper.minReviews ?? null,
      customRules: buildCustomRules(brief) || null,
      active: true,
      createdBy: user.id,
    })
    .returning({ id: harvestSearches.id });

  // 4) Optional: buy + attach a local number for the city (REAL charge).
  if (p.buyNumber?.phoneNumber) {
    try {
      await buyNumber({
        phoneNumber: p.buyNumber.phoneNumber,
        areaCode: p.buyNumber.areaCode,
        campaignId,
        marketId,
        createdBy: user.id,
      });
    } catch {
      /* number purchase is optional — never fail the launch over it */
    }
  }

  // 5) Kick off the first harvest after responding (so launch returns fast).
  if (p.runNow) {
    const searchId = search.id;
    after(async () => {
      try {
        await runHarvestSearch(searchId, { trigger: "manual", maxBusinesses: 8, createdBy: user.id });
      } catch {
        /* harvest errors are logged in harvestRuns; don't crash the response */
      }
    });
  }

  revalidatePath("/campaigns");
  revalidatePath("/", "layout");
  return { ok: true, id: campaignId };
}
