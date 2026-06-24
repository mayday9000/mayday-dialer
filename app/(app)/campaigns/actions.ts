"use server";

import { and, eq, ne, sql, desc } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import {
  campaigns,
  campaignLeads,
  leads,
  LEAD_STATUSES,
  type LeadStatus,
  type CampaignBrief,
} from "@/lib/db/schema";
import { requireUser } from "@/lib/auth-server";
import { generateCallerBrief, callerBriefToMarkdown } from "@/lib/ai/caller-brief";

export type Result = { ok: true; id?: string } | { ok: false; error: string };

async function seedLeads(campaignId: string, seed: string) {
  if (seed === "none") return;
  const ids = await db
    .select({ id: leads.id })
    .from(leads)
    .where(
      seed === "all"
        ? undefined
        : (LEAD_STATUSES as readonly string[]).includes(seed)
          ? eq(leads.status, seed as LeadStatus)
          : sql`false`,
    );
  if (!ids.length) return;
  await db
    .insert(campaignLeads)
    .values(ids.map((r) => ({ campaignId, leadId: r.id })))
    .onConflictDoNothing();
}

export async function createCampaign(input: {
  name: string;
  description?: string;
  brief?: string;
  location?: string;
  industry?: string;
  scriptId?: string | null;
  briefData?: CampaignBrief | null;
  seed?: string; // "all" | "none" | a LeadStatus
}): Promise<Result> {
  const user = await requireUser();
  if (!input.name.trim()) return { ok: false, error: "Name the campaign." };

  const [row] = await db
    .insert(campaigns)
    .values({
      name: input.name.trim(),
      description: input.description?.trim() || null,
      brief: input.brief?.trim() || null,
      location: input.location?.trim() || null,
      industry: input.industry?.trim() || null,
      scriptId: input.scriptId || null,
      briefData: input.briefData ?? null,
      createdBy: user.id,
    })
    .returning({ id: campaigns.id });

  await seedLeads(row.id, input.seed ?? "none");

  revalidatePath("/campaigns");
  revalidatePath("/", "layout");
  return { ok: true, id: row.id };
}

export async function updateCampaignMeta(
  id: string,
  input: {
    name?: string;
    description?: string;
    brief?: string;
    location?: string;
    industry?: string;
    meetingTitleTemplate?: string;
    meetingDescriptionTemplate?: string;
    meetingDurationMin?: number;
    meetingLocation?: string;
  },
): Promise<Result> {
  await requireUser();
  const updates: Record<string, string | number | null | Date> = { updatedAt: new Date() };
  if (input.name !== undefined) {
    if (!input.name.trim()) return { ok: false, error: "Name can't be empty." };
    updates.name = input.name.trim();
  }
  if (input.description !== undefined) updates.description = input.description.trim() || null;
  if (input.brief !== undefined) updates.brief = input.brief.trim() || null;
  if (input.location !== undefined) updates.location = input.location.trim() || null;
  if (input.industry !== undefined) updates.industry = input.industry.trim() || null;
  if (input.meetingTitleTemplate !== undefined)
    updates.meetingTitleTemplate = input.meetingTitleTemplate.trim() || null;
  if (input.meetingDescriptionTemplate !== undefined)
    updates.meetingDescriptionTemplate = input.meetingDescriptionTemplate.trim() || null;
  if (input.meetingDurationMin !== undefined)
    updates.meetingDurationMin = input.meetingDurationMin;
  if (input.meetingLocation !== undefined)
    updates.meetingLocation = input.meetingLocation.trim() || null;

  await db.update(campaigns).set(updates).where(eq(campaigns.id, id));
  revalidatePath(`/campaigns/${id}`);
  revalidatePath("/", "layout");
  return { ok: true, id };
}

/**
 * Write (or refresh) the campaign's caller brief — the study sheet on the
 * overview. Pulls from the structured brief + meta and saves rich markdown to
 * campaigns.brief, plus the structured pain points / objections into briefData.
 */
export async function generateCampaignBrief(id: string): Promise<Result> {
  await requireUser();
  const campaign = await db.query.campaigns.findFirst({ where: eq(campaigns.id, id) });
  if (!campaign) return { ok: false, error: "Campaign not found." };

  const result = await generateCallerBrief({
    name: campaign.name,
    description: campaign.description,
    industry: campaign.industry,
    location: campaign.location,
    existingBrief: campaign.brief,
    brief: campaign.briefData,
  });
  if (!result) {
    return { ok: false, error: "Couldn't generate a brief. Check that ANTHROPIC_API_KEY is set." };
  }

  const markdown = callerBriefToMarkdown(result);
  const briefData: CampaignBrief | null = campaign.briefData
    ? { ...campaign.briefData, painPoints: result.painPoints, objections: result.objections }
    : null;

  await db
    .update(campaigns)
    .set({ brief: markdown, ...(briefData ? { briefData } : {}), updatedAt: new Date() })
    .where(eq(campaigns.id, id));

  revalidatePath(`/campaigns/${id}`);
  return { ok: true, id };
}

export async function updateCampaign(
  id: string,
  input: { name: string; description?: string; scriptId?: string | null },
): Promise<Result> {
  await requireUser();
  if (!input.name.trim()) return { ok: false, error: "Name the campaign." };
  await db
    .update(campaigns)
    .set({
      name: input.name.trim(),
      description: input.description?.trim() || null,
      scriptId: input.scriptId || null,
      updatedAt: new Date(),
    })
    .where(eq(campaigns.id, id));
  revalidatePath(`/campaigns/${id}`);
  revalidatePath("/campaigns");
  return { ok: true, id };
}

export async function addLeadsToCampaign(campaignId: string, seed: string): Promise<Result> {
  await requireUser();
  await seedLeads(campaignId, seed);
  revalidatePath(`/campaigns/${campaignId}`);
  return { ok: true };
}

// A member counts as "qualifying" when it's a real, working lead — not
// discarded (archived) and not a harvested candidate still pending/rejected.
const QUALIFYING_MEMBER = sql`${leads.archived} = false and (${leads.reviewState} is null or ${leads.reviewState} not in ('pending','rejected'))`;

/**
 * Share leads between offers: copy the *qualifying* members of one campaign into
 * another. Idempotent — the (campaign, lead) unique index means re-running only
 * adds the ones not already there; returns how many were actually added.
 *
 * Funnel state is still global on the lead (see the per-campaign-funnel plan),
 * so a `new` lead copied here is immediately dialable under the new offer, while
 * a do_not_call / booked / bad_number comes along but stays out of the queue.
 */
export async function addLeadsFromCampaign(
  targetCampaignId: string,
  sourceCampaignId: string,
): Promise<Result & { added?: number }> {
  await requireUser();
  if (!sourceCampaignId || targetCampaignId === sourceCampaignId) {
    return { ok: false, error: "Pick a different campaign to copy from." };
  }

  const rows = await db
    .select({ leadId: campaignLeads.leadId })
    .from(campaignLeads)
    .innerJoin(leads, eq(leads.id, campaignLeads.leadId))
    .where(and(eq(campaignLeads.campaignId, sourceCampaignId), QUALIFYING_MEMBER));

  if (!rows.length) return { ok: true, added: 0 };

  const inserted = await db
    .insert(campaignLeads)
    .values(rows.map((r) => ({ campaignId: targetCampaignId, leadId: r.leadId })))
    .onConflictDoNothing()
    .returning({ id: campaignLeads.id });

  revalidatePath(`/campaigns/${targetCampaignId}`);
  revalidatePath(`/campaigns/${targetCampaignId}/leads`);
  return { ok: true, added: inserted.length };
}

/** Other campaigns you could copy qualifying leads from, with their counts. */
export async function listShareableCampaigns(
  excludeCampaignId: string,
): Promise<{ id: string; name: string; qualifying: number }[]> {
  await requireUser();
  return db
    .select({
      id: campaigns.id,
      name: campaigns.name,
      qualifying: sql<number>`coalesce(sum(case when ${QUALIFYING_MEMBER} then 1 else 0 end), 0)::int`,
    })
    .from(campaigns)
    .leftJoin(campaignLeads, eq(campaignLeads.campaignId, campaigns.id))
    .leftJoin(leads, eq(leads.id, campaignLeads.leadId))
    .where(ne(campaigns.id, excludeCampaignId))
    .groupBy(campaigns.id)
    .orderBy(desc(campaigns.createdAt));
}

export async function removeLeadFromCampaign(
  campaignId: string,
  leadId: string,
): Promise<Result> {
  await requireUser();
  await db
    .delete(campaignLeads)
    .where(and(eq(campaignLeads.campaignId, campaignId), eq(campaignLeads.leadId, leadId)));
  revalidatePath(`/campaigns/${campaignId}`);
  return { ok: true };
}

export async function deleteCampaign(id: string): Promise<Result> {
  await requireUser();
  await db.delete(campaigns).where(eq(campaigns.id, id));
  revalidatePath("/campaigns");
  revalidatePath("/", "layout");
  return { ok: true };
}

// Used by the create form to know whether a "seed" would match anything.
export async function countLeadsByStatus(): Promise<Record<string, number>> {
  await requireUser();
  const rows = await db
    .select({ status: leads.status, count: sql<number>`count(*)::int` })
    .from(leads)
    .groupBy(leads.status);
  const out: Record<string, number> = { all: 0 };
  for (const r of rows) {
    out[r.status] = r.count;
    out.all += r.count;
  }
  return out;
}
