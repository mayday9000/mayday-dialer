"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { leads, leadEvents } from "@/lib/db/schema";
import { requireAdmin } from "@/lib/auth-server";

export type Result = { ok: true } | { ok: false; error: string };

export async function approveCandidate(id: string): Promise<Result> {
  const user = await requireAdmin();
  await db
    .update(leads)
    .set({ reviewState: "approved", updatedAt: new Date() })
    .where(eq(leads.id, id));
  await db.insert(leadEvents).values({
    leadId: id,
    userId: user.id,
    type: "system",
    body: "Approved from review queue",
    metadata: { source: "review" },
  });
  revalidatePath("/admin/lead-sources/review");
  revalidatePath("/dial");
  return { ok: true };
}

export async function rejectCandidate(id: string, reason?: string): Promise<Result> {
  const user = await requireAdmin();
  await db
    .update(leads)
    .set({
      reviewState: "rejected",
      archived: true,
      archivedReason: reason?.trim() || "Rejected in review",
      updatedAt: new Date(),
    })
    .where(eq(leads.id, id));
  await db.insert(leadEvents).values({
    leadId: id,
    userId: user.id,
    type: "system",
    body: `Rejected from review queue${reason ? `: ${reason}` : ""}`,
    metadata: { source: "review" },
  });
  revalidatePath("/admin/lead-sources/review");
  return { ok: true };
}
