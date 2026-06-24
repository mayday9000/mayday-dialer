/**
 * Auto call notes — so the rep never has to type notes.
 *
 * After a call's transcript completes, Claude reads it and writes the notes:
 * a short summary, the key points, and the concrete next step. These are stored
 * on the transcript (analysis) and dropped into the lead's timeline + call log
 * automatically.
 */
import { eq, and, asc, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { callTranscripts, leads, leadEvents, callLogs, campaignLeads, campaigns } from "@/lib/db/schema";
import type { TranscriptSegment, TranscriptAnalysis, CallOutcome } from "@/lib/db/schema";
import { claudeText, parseJsonLoose, CLAUDE_MODELS, isAnthropicConfigured } from "./client";
import { segmentsToText } from "@/lib/transcripts";

export type CallNotes = {
  summary: string;
  bullets: string[];
  nextStep: string | null;
  objections: string[];
  sentiment: "positive" | "neutral" | "negative" | null;
  suggestedOutcome: CallOutcome | null;
};

const SYSTEM = `You write a salesperson's call notes from a transcript of an outbound B2B sales call (any industry). The rep is "Agent"; the person they reached is "Prospect". Write the notes the rep would have taken, so they don't have to.

Rules:
- Be factual and specific. Use ONLY what's in the transcript. Never invent names, numbers, commitments, or callback times that weren't said.
- summary: 1-3 sentences, plain past tense — what happened and where it landed.
- bullets: 2-5 short key points worth remembering (who answered, decision-maker, interest level, concrete details, dates mentioned). Highest-signal first. Omit filler. No trailing periods.
- nextStep: the single concrete follow-up the rep should take, or null if none.
- objections: any pushback/concerns the prospect raised (short phrases), or [].
- sentiment: how receptive the prospect was — "positive" | "neutral" | "negative".
- suggestedOutcome: your best guess of the call outcome from this exact set: connected, voicemail, no_answer, busy, gatekeeper, wrong_number, not_interested, booked, callback, do_not_call, mailbox_full (voicemail box was full), bad_connection (couldn't hear each other / line issues). Use null if unclear.`;

const VALID_OUTCOMES = new Set<string>([
  "connected", "voicemail", "no_answer", "busy", "gatekeeper",
  "wrong_number", "not_interested", "booked", "callback", "do_not_call",
  "mailbox_full", "bad_connection",
]);

export type CallNotesContext = {
  companyName: string | null;
  contactName: string | null;
  title: string | null;
  city: string | null;
  durationSec: number | null;
  segments: TranscriptSegment[];
  text: string;
  // Optional campaign context (any vertical) — sharpens the notes + next step.
  campaign?: { vertical?: string | null; goal?: string | null; offer?: string | null } | null;
};

/** Generate notes from a transcript. Returns null if AI is off or unusable. */
export async function generateCallNotes(ctx: CallNotesContext): Promise<CallNotes | null> {
  if (!isAnthropicConfigured()) return null;

  const transcript = ctx.segments.length ? segmentsToText(ctx.segments) : ctx.text;
  if (!transcript || transcript.trim().length < 12) return null; // nothing to summarize

  const c = ctx.campaign;
  const campaignLine =
    c && (c.vertical || c.goal || c.offer)
      ? `Campaign: ${[c.vertical && `targeting ${c.vertical}`, c.offer && `offer "${c.offer}"`, c.goal && `goal "${c.goal}"`].filter(Boolean).join("; ")}. Tailor the next step toward that goal.\n`
      : "";

  const prompt = `${campaignLine}Lead: ${ctx.companyName ?? "Unknown company"}${ctx.contactName ? ` — contact ${ctx.contactName}${ctx.title ? `, ${ctx.title}` : ""}` : ""}${ctx.city ? ` (${ctx.city})` : ""}.
Call duration: ${ctx.durationSec ? `${ctx.durationSec}s` : "unknown"}.

Transcript:
"""
${transcript.slice(0, 12000)}
"""

Return ONLY this JSON object, nothing else:
{"summary": string, "bullets": string[], "nextStep": string|null, "objections": string[], "sentiment": "positive"|"neutral"|"negative", "suggestedOutcome": string|null}`;

  const out = await claudeText({
    model: CLAUDE_MODELS.haiku,
    system: SYSTEM,
    prompt,
    maxTokens: 700,
  });
  const parsed = parseJsonLoose<Partial<CallNotes>>(out);
  if (!parsed || typeof parsed.summary !== "string" || !parsed.summary.trim()) return null;

  const so = typeof parsed.suggestedOutcome === "string" && VALID_OUTCOMES.has(parsed.suggestedOutcome)
    ? (parsed.suggestedOutcome as CallOutcome)
    : null;

  return {
    summary: parsed.summary.trim(),
    bullets: Array.isArray(parsed.bullets)
      ? parsed.bullets.filter((b): b is string => typeof b === "string").map((b) => b.trim()).filter(Boolean).slice(0, 5)
      : [],
    nextStep: typeof parsed.nextStep === "string" && parsed.nextStep.trim() ? parsed.nextStep.trim() : null,
    objections: Array.isArray(parsed.objections)
      ? parsed.objections.filter((o): o is string => typeof o === "string").map((o) => o.trim()).filter(Boolean).slice(0, 5)
      : [],
    sentiment:
      parsed.sentiment === "positive" || parsed.sentiment === "neutral" || parsed.sentiment === "negative"
        ? parsed.sentiment
        : null,
    suggestedOutcome: so,
  };
}

/** Render the notes as a timeline-friendly body string. */
function notesToBody(n: CallNotes): string {
  const lines = [n.summary];
  if (n.bullets.length) lines.push("", ...n.bullets.map((b) => `• ${b}`));
  if (n.nextStep) lines.push("", `Next: ${n.nextStep}`);
  return lines.join("\n");
}

/**
 * Generate notes for a completed transcript and write them where the rep will
 * see them: onto the transcript's analysis, as a lead-timeline note, and into
 * the call log's notes (when the rep left it blank). Idempotent — re-running
 * replaces the prior auto-note instead of duplicating it.
 */
export async function applyCallNotes(transcriptId: string): Promise<boolean> {
  const [t] = await db.select().from(callTranscripts).where(eq(callTranscripts.id, transcriptId)).limit(1);
  if (!t) return false;
  if (t.status !== "completed") return false;
  if (!t.segments.length && !t.text.trim()) return false;

  const [lead] = await db
    .select({
      companyName: leads.companyName,
      contactName: leads.contactName,
      title: leads.title,
      customFields: leads.customFields,
    })
    .from(leads)
    .where(eq(leads.id, t.leadId))
    .limit(1);

  // The lead's primary campaign brief (if any) makes notes campaign-aware for
  // any vertical. Absent (no campaign / no brief) → still works generically.
  const [camp] = await db
    .select({ brief: campaigns.briefData })
    .from(campaignLeads)
    .innerJoin(campaigns, eq(campaigns.id, campaignLeads.campaignId))
    .where(eq(campaignLeads.leadId, t.leadId))
    .orderBy(asc(campaignLeads.addedAt))
    .limit(1);

  const notes = await generateCallNotes({
    companyName: lead?.companyName ?? null,
    contactName: lead?.contactName ?? null,
    title: lead?.title ?? null,
    city: lead?.customFields?.City ?? null,
    durationSec: t.recordingDurationSec,
    segments: t.segments,
    text: t.text,
    campaign: camp?.brief
      ? { vertical: camp.brief.vertical, goal: camp.brief.goal, offer: camp.brief.offer }
      : null,
  });
  if (!notes) return false;

  const analysis: TranscriptAnalysis = {
    ...(t.analysis ?? {}),
    summary: notes.summary,
    bullets: notes.bullets,
    nextStep: notes.nextStep,
    objections: notes.objections,
    sentiment: notes.sentiment ?? undefined,
    notedAt: new Date().toISOString(),
  };
  await db
    .update(callTranscripts)
    .set({ analysis, updatedAt: new Date() })
    .where(eq(callTranscripts.id, transcriptId));

  // Replace any prior auto-note for this transcript, then write a fresh one, so
  // the rep's timeline always shows exactly one up-to-date AI summary.
  await db
    .delete(leadEvents)
    .where(
      and(
        eq(leadEvents.type, "note"),
        sql`${leadEvents.metadata}->>'transcriptId' = ${transcriptId}`,
      ),
    );
  await db.insert(leadEvents).values({
    leadId: t.leadId,
    userId: t.userId,
    type: "note",
    body: notesToBody(notes),
    metadata: { ai: true, transcriptId, callLogId: t.callLogId },
  });

  // Fill the call log's notes only if the rep didn't write their own.
  if (t.callLogId) {
    await db
      .update(callLogs)
      .set({ notes: notes.summary })
      .where(and(eq(callLogs.id, t.callLogId), sql`(${callLogs.notes} is null or ${callLogs.notes} = '')`));
  }

  return true;
}
