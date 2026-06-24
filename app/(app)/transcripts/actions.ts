"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { callTranscripts, type TranscriptSegment } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth-server";
import { parseTextToSegments, segmentsToText, agentTalkRatio, transcriptPatchFromResult } from "@/lib/transcripts";
import { getTranscriptionEngine } from "@/lib/transcription";
import { applyCallNotes } from "@/lib/ai/call-notes";

export type Result = { ok: true } | { ok: false; error: string };

function analysisFor(segments: TranscriptSegment[]) {
  const ratio = agentTalkRatio(segments);
  return ratio == null ? {} : { talkRatioAgent: Math.round(ratio * 100) / 100 };
}

/** Create or replace a manually-entered transcript for a call. */
export async function saveManualTranscript(input: {
  transcriptId?: string;
  callLogId?: string | null;
  leadId: string;
  callSid?: string | null;
  rawText: string;
}): Promise<Result> {
  const user = await requireUser();
  const text = input.rawText.trim();
  if (!text) return { ok: false, error: "Transcript is empty." };
  const segments = parseTextToSegments(text);
  const analysis = analysisFor(segments);

  let transcriptId: string;
  if (input.transcriptId) {
    await db
      .update(callTranscripts)
      .set({ segments, text: segmentsToText(segments), source: "manual", status: "completed", analysis, error: null, updatedAt: new Date() })
      .where(eq(callTranscripts.id, input.transcriptId));
    transcriptId = input.transcriptId;
  } else {
    const [row] = await db
      .insert(callTranscripts)
      .values({
        leadId: input.leadId,
        callLogId: input.callLogId ?? null,
        callSid: input.callSid ?? null,
        userId: user.id,
        source: "manual",
        status: "completed",
        segments,
        text: segmentsToText(segments),
        analysis,
      })
      .returning({ id: callTranscripts.id });
    transcriptId = row.id;
  }

  // Auto-summarize the pasted transcript too (best-effort; never blocks success).
  try {
    await applyCallNotes(transcriptId);
  } catch {
    /* notes are a bonus; leave the transcript saved */
  }
  revalidatePath(`/leads/${input.leadId}`);
  return { ok: true };
}

/** Start (or retry) automatic transcription of a captured recording. */
export async function generateTranscript(transcriptId: string): Promise<Result> {
  await requireUser();
  const engine = getTranscriptionEngine();
  if (!engine) return { ok: false, error: "No transcription engine is configured." };

  const [t] = await db.select().from(callTranscripts).where(eq(callTranscripts.id, transcriptId)).limit(1);
  if (!t) return { ok: false, error: "Transcript not found." };
  if (!t.recordingSid) return { ok: false, error: "No recording is attached to this call yet." };

  try {
    if (engine.kind === "sync" && engine.transcribe) {
      // Deepgram/Whisper: transcribe now, store the finished result.
      const result = await engine.transcribe({ recordingSid: t.recordingSid });
      await db
        .update(callTranscripts)
        .set(transcriptPatchFromResult(result))
        .where(eq(callTranscripts.id, transcriptId));
      if (result.status === "completed") await applyCallNotes(transcriptId).catch(() => {});
      revalidatePath(`/leads/${t.leadId}`);
      return result.status === "failed" ? { ok: false, error: result.error || "Transcription failed." } : { ok: true };
    }
    // Twilio VI: kick off, poll via refreshTranscript.
    const { providerTranscriptSid } = await engine.start!({ recordingSid: t.recordingSid });
    await db
      .update(callTranscripts)
      .set({ providerTranscriptSid, status: "processing", error: null, updatedAt: new Date() })
      .where(eq(callTranscripts.id, transcriptId));
    revalidatePath(`/leads/${t.leadId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to start transcription." };
  }
}

/** Poll the engine for a processing transcript and store results when ready. */
export async function refreshTranscript(transcriptId: string): Promise<Result & { status?: string }> {
  await requireUser();
  const engine = getTranscriptionEngine();
  if (!engine) return { ok: false, error: "No transcription engine is configured." };

  if (!engine.fetch) return { ok: false, error: "This engine doesn't support refresh." };
  const [t] = await db.select().from(callTranscripts).where(eq(callTranscripts.id, transcriptId)).limit(1);
  if (!t) return { ok: false, error: "Transcript not found." };
  if (!t.providerTranscriptSid) return { ok: false, error: "Nothing to refresh yet." };

  try {
    const result = await engine.fetch(t.providerTranscriptSid);
    // Keep prior segments/text if the poll isn't complete yet.
    const patch = transcriptPatchFromResult({
      status: result.status,
      segments: result.segments.length ? result.segments : t.segments,
      text: result.text || t.text,
      language: result.language ?? t.language,
      error: result.error ?? null,
    });
    await db.update(callTranscripts).set(patch).where(eq(callTranscripts.id, transcriptId));
    if (result.status === "completed") await applyCallNotes(transcriptId).catch(() => {});
    revalidatePath(`/leads/${t.leadId}`);
    return { ok: true, status: result.status };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to refresh transcript." };
  }
}

/** Re-run the AI call notes for a transcript (manual "re-summarize"). */
export async function regenerateCallNotes(transcriptId: string): Promise<Result> {
  await requireUser();
  const ok = await applyCallNotes(transcriptId).catch(() => false);
  if (!ok) return { ok: false, error: "Couldn't summarize — needs a completed transcript (and AI configured)." };
  const [t] = await db
    .select({ leadId: callTranscripts.leadId })
    .from(callTranscripts)
    .where(eq(callTranscripts.id, transcriptId))
    .limit(1);
  if (t) revalidatePath(`/leads/${t.leadId}`);
  return { ok: true };
}

export async function deleteTranscript(transcriptId: string): Promise<Result> {
  await requireUser();
  const [row] = await db
    .delete(callTranscripts)
    .where(eq(callTranscripts.id, transcriptId))
    .returning({ leadId: callTranscripts.leadId });
  if (row) revalidatePath(`/leads/${row.leadId}`);
  return { ok: true };
}
