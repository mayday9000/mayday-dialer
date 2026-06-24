"use server";

import { and, eq, isNull, or, lt } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import {
  leads,
  leadEvents,
  callLogs,
  callTranscripts,
  LEAD_STATUSES,
  CALL_OUTCOMES,
  type LeadStatus,
  type CallOutcome,
} from "@/lib/db/schema";
import { requireUser } from "@/lib/auth-server";
import { outcomeLabel, CLAIM_TTL_MS } from "@/lib/dial";

export type Result = { ok: true } | { ok: false; error: string };

// Outcomes where the rep actually engaged the lead → it becomes "theirs"
// (sticky ownership). Pure no-answer/busy/wrong-number don't claim ownership.
const OWNS_OUTCOMES = new Set<CallOutcome>([
  "connected",
  "booked",
  "callback",
  "gatekeeper",
  "voicemail",
  "not_interested",
]);

/**
 * Atomically lease a lead before dialing it. Succeeds if it's unclaimed, held
 * by this rep, or the prior lease expired — a single conditional UPDATE, so
 * concurrent reps can't both win. Returns ok:false if another rep holds it.
 */
export async function claimLead(leadId: string): Promise<Result> {
  const user = await requireUser();
  const cutoff = new Date(Date.now() - CLAIM_TTL_MS);
  const rows = await db
    .update(leads)
    .set({ claimedBy: user.id, claimedAt: new Date() })
    .where(
      and(
        eq(leads.id, leadId),
        or(isNull(leads.claimedBy), eq(leads.claimedBy, user.id), lt(leads.claimedAt, cutoff)),
      ),
    )
    .returning({ id: leads.id });
  if (!rows.length) return { ok: false, error: "Another rep is calling this lead." };
  return { ok: true };
}

export async function logCallOutcome(input: {
  leadId: string;
  outcome: CallOutcome;
  status: LeadStatus;
  note?: string;
  callbackAt?: string | null;
  durationSec?: number;
  callSid?: string;
  provider?: string;
  campaignId?: string | null; // the offer this call was made under (per-campaign call log)
  marketId?: string | null; // the city (within the campaign) this call was made under
}): Promise<Result> {
  const user = await requireUser();

  if (!(CALL_OUTCOMES as readonly string[]).includes(input.outcome)) {
    return { ok: false, error: "Invalid outcome." };
  }
  if (!(LEAD_STATUSES as readonly string[]).includes(input.status)) {
    return { ok: false, error: "Invalid status." };
  }

  const lead = await db.query.leads.findFirst({ where: eq(leads.id, input.leadId) });
  if (!lead) return { ok: false, error: "Lead not found." };

  const note = input.note?.trim();
  const callSid = input.callSid?.trim() || null;

  // 1) Call log row
  const [log] = await db
    .insert(callLogs)
    .values({
      leadId: input.leadId,
      campaignId: input.campaignId ?? null,
      marketId: input.marketId ?? null,
      userId: user.id,
      provider: input.provider ?? "stub",
      providerCallSid: callSid,
      status: "completed",
      outcome: input.outcome,
      durationSec: input.durationSec ?? 0,
      notes: note || null,
      endedAt: new Date(),
    })
    .returning({ id: callLogs.id });

  // If the recording-status callback already created a transcript row for this
  // CallSid (it can arrive before or after we log here), link it to this log.
  if (callSid && log?.id) {
    await db
      .update(callTranscripts)
      .set({ callLogId: log.id, updatedAt: new Date() })
      .where(and(eq(callTranscripts.callSid, callSid), isNull(callTranscripts.callLogId)));
  }

  // 2) Timeline event
  const body = `Call — ${outcomeLabel(input.outcome)}${note ? `\n${note}` : ""}`;
  await db.insert(leadEvents).values({
    leadId: input.leadId,
    userId: user.id,
    type: "call",
    outcome: input.outcome,
    body,
  });

  // 3) Update the lead — and handle multi-rep ownership/lease:
  //    - release the dial lease (the call is over)
  //    - if the rep actually engaged, the lead becomes theirs (sticky owner) so
  //      its follow-ups route back to them.
  await db
    .update(leads)
    .set({
      status: input.status,
      callbackAt:
        input.callbackAt === undefined
          ? lead.callbackAt
          : input.callbackAt
            ? new Date(input.callbackAt)
            : null,
      claimedBy: null,
      claimedAt: null,
      ...(OWNS_OUTCOMES.has(input.outcome) ? { ownerId: user.id } : {}),
      updatedAt: new Date(),
    })
    .where(eq(leads.id, input.leadId));

  revalidatePath(`/leads/${input.leadId}`);
  revalidatePath("/leads");
  if (input.campaignId) revalidatePath(`/campaigns/${input.campaignId}/calls`);
  revalidatePath("/");
  return { ok: true };
}
