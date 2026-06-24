"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { harvestSearches, type HarvestStats } from "@/lib/db/schema";
import { requireAdmin } from "@/lib/auth-server";
import { runHarvestSearch } from "@/lib/harvest/run";

export type Result = { ok: true; id?: string } | { ok: false; error: string };
export type RunResult = { ok: true; stats: HarvestStats } | { ok: false; error: string };

export type SearchInput = {
  label: string;
  location: string;
  state?: string | null;
  keywords?: string | null;
  extraLocations?: string[];
  radiusMeters?: number;
  targetCampaignId?: string | null;
  requireWebsite?: boolean;
  requirePhone?: boolean;
  minRating?: number | null;
  minReviews?: number | null;
  maxPerRun?: number;
  customRules?: string | null;
  minDialable?: number;
  active?: boolean;
};

const clean = (s?: string | null) => (s ?? "").trim() || null;
const cleanList = (xs?: string[]) => (xs ?? []).map((s) => s.trim()).filter(Boolean);

function toRow(input: SearchInput) {
  return {
    label: input.label.trim(),
    location: input.location.trim(),
    state: clean(input.state),
    keywords: clean(input.keywords),
    extraLocations: cleanList(input.extraLocations),
    radiusMeters: input.radiusMeters ?? 40000,
    targetCampaignId: input.targetCampaignId || null,
    requireWebsite: input.requireWebsite ?? false,
    requirePhone: input.requirePhone ?? true,
    minRating: input.minRating ?? null,
    minReviews: input.minReviews ?? null,
    maxPerRun: input.maxPerRun ?? 30,
    customRules: clean(input.customRules),
    minDialable: input.minDialable ?? 25,
    active: input.active ?? true,
  };
}

function validate(input: SearchInput): string | null {
  if (!input.label?.trim()) return "Name this lead source.";
  if (!input.location?.trim()) return 'Set a location (e.g. "Springfield, IL").';
  return null;
}

export async function createSearch(input: SearchInput): Promise<Result> {
  const user = await requireAdmin();
  const err = validate(input);
  if (err) return { ok: false, error: err };
  const [row] = await db
    .insert(harvestSearches)
    .values({ ...toRow(input), createdBy: user.id })
    .returning({ id: harvestSearches.id });
  revalidatePath("/admin/lead-sources");
  return { ok: true, id: row.id };
}

export async function updateSearch(id: string, input: SearchInput): Promise<Result> {
  await requireAdmin();
  const err = validate(input);
  if (err) return { ok: false, error: err };
  await db
    .update(harvestSearches)
    .set({ ...toRow(input), updatedAt: new Date() })
    .where(eq(harvestSearches.id, id));
  revalidatePath("/admin/lead-sources");
  return { ok: true, id };
}

export async function toggleSearchActive(id: string, active: boolean): Promise<Result> {
  await requireAdmin();
  await db
    .update(harvestSearches)
    .set({ active, updatedAt: new Date() })
    .where(eq(harvestSearches.id, id));
  revalidatePath("/admin/lead-sources");
  return { ok: true, id };
}

export async function deleteSearch(id: string): Promise<Result> {
  await requireAdmin();
  await db.delete(harvestSearches).where(eq(harvestSearches.id, id));
  revalidatePath("/admin/lead-sources");
  return { ok: true };
}

export async function runHarvest(id: string): Promise<RunResult> {
  await requireAdmin();
  try {
    const stats = await runHarvestSearch(id, { trigger: "button", maxBusinesses: 30 });
    revalidatePath("/admin/lead-sources");
    if ((stats.approved ?? 0) > 0 || (stats.queued ?? 0) > 0) {
      revalidatePath("/dial");
      revalidatePath("/admin/lead-sources/review");
    }
    return { ok: true, stats };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Harvest failed." };
  }
}
