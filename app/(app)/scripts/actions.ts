"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { scripts, campaigns, userCampaignScripts } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth-server";

export type Result = { ok: true; id?: string } | { ok: false; error: string };

export async function createScript(
  name: string,
  contentMarkdown: string,
  campaignId?: string,
): Promise<Result> {
  const user = await requireUser();
  if (!name.trim()) return { ok: false, error: "Give the script a name." };

  const [row] = await db
    .insert(scripts)
    .values({ name: name.trim(), contentMarkdown, campaignId: campaignId ?? null, createdBy: user.id })
    .returning({ id: scripts.id });

  if (campaignId) {
    // First script for a campaign becomes its primary automatically.
    const existing = await db
      .select({ id: scripts.id })
      .from(scripts)
      .where(eq(scripts.campaignId, campaignId));
    if (existing.length === 1) {
      await db.update(campaigns).set({ scriptId: row.id }).where(eq(campaigns.id, campaignId));
    }
    revalidatePath(`/campaigns/${campaignId}/scripts`);
    revalidatePath(`/campaigns/${campaignId}`);
  }

  revalidatePath("/scripts");
  return { ok: true, id: row.id };
}

/** Admin-only: set the campaign's default script (what new reps see first). */
export async function setPrimaryScript(campaignId: string, scriptId: string): Promise<Result> {
  const user = await requireUser();
  if (user.role !== "admin") {
    return { ok: false, error: "Only an admin can set the team's default script." };
  }
  await db.update(campaigns).set({ scriptId }).where(eq(campaigns.id, campaignId));
  revalidatePath(`/campaigns/${campaignId}/scripts`);
  revalidatePath(`/campaigns/${campaignId}`);
  return { ok: true };
}

/** Record THIS rep's chosen script for a campaign (their personal pick). */
export async function selectScript(campaignId: string, scriptId: string): Promise<Result> {
  const user = await requireUser();
  await db
    .insert(userCampaignScripts)
    .values({ userId: user.id, campaignId, scriptId })
    .onConflictDoUpdate({
      target: [userCampaignScripts.userId, userCampaignScripts.campaignId],
      set: { scriptId, updatedAt: new Date() },
    });
  revalidatePath(`/campaigns/${campaignId}/scripts`);
  revalidatePath("/dial");
  return { ok: true };
}

/** Fork a script into a copy owned by the current rep, and make it their pick.
 *  This is how a rep tweaks someone else's script without touching the original. */
export async function duplicateScript(scriptId: string): Promise<Result> {
  const user = await requireUser();
  const src = await db.query.scripts.findFirst({ where: eq(scripts.id, scriptId) });
  if (!src) return { ok: false, error: "Script not found." };

  const [row] = await db
    .insert(scripts)
    .values({
      name: `${src.name} (copy)`,
      contentMarkdown: src.contentMarkdown,
      campaignId: src.campaignId,
      createdBy: user.id,
    })
    .returning({ id: scripts.id });

  if (src.campaignId) {
    // The fork becomes the rep's active script immediately.
    await db
      .insert(userCampaignScripts)
      .values({ userId: user.id, campaignId: src.campaignId, scriptId: row.id })
      .onConflictDoUpdate({
        target: [userCampaignScripts.userId, userCampaignScripts.campaignId],
        set: { scriptId: row.id, updatedAt: new Date() },
      });
    revalidatePath(`/campaigns/${src.campaignId}/scripts`);
    revalidatePath("/dial");
  }

  revalidatePath("/scripts");
  return { ok: true, id: row.id };
}

export async function updateScript(
  id: string,
  name: string,
  contentMarkdown: string,
): Promise<Result> {
  const user = await requireUser();
  if (!name.trim()) return { ok: false, error: "Give the script a name." };

  const existing = await db.query.scripts.findFirst({ where: eq(scripts.id, id) });
  if (!existing) return { ok: false, error: "Script not found." };
  if (existing.createdBy !== user.id && user.role !== "admin") {
    return {
      ok: false,
      error: "You can only edit scripts you created. Duplicate it to make your own.",
    };
  }

  await db
    .update(scripts)
    .set({ name: name.trim(), contentMarkdown, updatedAt: new Date() })
    .where(eq(scripts.id, id));

  revalidatePath("/scripts");
  revalidatePath(`/scripts/${id}`);
  if (existing.campaignId) revalidatePath(`/campaigns/${existing.campaignId}/scripts`);
  return { ok: true, id };
}

export async function deleteScript(id: string): Promise<Result> {
  const user = await requireUser();
  const existing = await db.query.scripts.findFirst({ where: eq(scripts.id, id) });
  if (!existing) return { ok: false, error: "Script not found." };
  if (existing.createdBy !== user.id && user.role !== "admin") {
    return { ok: false, error: "You can only delete scripts you created." };
  }

  await db.delete(scripts).where(eq(scripts.id, id));
  revalidatePath("/scripts");
  if (existing.campaignId) revalidatePath(`/campaigns/${existing.campaignId}/scripts`);
  return { ok: true };
}
