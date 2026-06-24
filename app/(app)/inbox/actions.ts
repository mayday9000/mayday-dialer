"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { voicemails, leads, campaignLeads } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth-server";
import { normalizePhone } from "@/lib/phone";

export type Result<T = unknown> = ({ ok: true } & T) | { ok: false; error: string };

/** Mark a voicemail dealt-with (or reopen it). */
export async function markVoicemailHandled(id: string, handled: boolean): Promise<Result> {
  const user = await requireUser();
  await db
    .update(voicemails)
    .set({
      handled,
      handledBy: handled ? user.id : null,
      handledAt: handled ? new Date() : null,
    })
    .where(eq(voicemails.id, id));
  revalidatePath("/inbox");
  revalidatePath("/", "layout"); // refresh the nav unread badge
  return { ok: true };
}

/** Turn an unknown caller's voicemail into a lead (so it can be dialed back),
 *  reusing an existing lead with that number if one exists. Returns the lead id. */
export async function addVoicemailLead(id: string): Promise<Result<{ leadId: string }>> {
  const user = await requireUser();
  const vm = await db.query.voicemails.findFirst({ where: eq(voicemails.id, id) });
  if (!vm) return { ok: false, error: "Voicemail not found." };
  if (vm.leadId) return { ok: true, leadId: vm.leadId };

  const norm = vm.fromNormalized || normalizePhone(vm.fromPhone);
  if (!norm) return { ok: false, error: "No caller number to add." };

  // The phone is the dedup key, so reuse an existing lead with this number.
  let leadId: string;
  const existing = await db.query.leads.findFirst({ where: eq(leads.phoneNormalized, norm) });
  if (existing) {
    leadId = existing.id;
  } else {
    const [created] = await db
      .insert(leads)
      .values({
        phone: vm.fromPhone,
        phoneNormalized: norm,
        source: "voicemail",
        createdBy: user.id,
      })
      .returning({ id: leads.id });
    leadId = created.id;
  }

  // Attach to the campaign/city the voicemail came in on, so it joins that queue.
  if (vm.campaignId) {
    await db
      .insert(campaignLeads)
      .values({ campaignId: vm.campaignId, leadId, marketId: vm.marketId ?? null })
      .onConflictDoNothing();
  }
  await db.update(voicemails).set({ leadId }).where(eq(voicemails.id, id));
  revalidatePath("/inbox");
  return { ok: true, leadId };
}
