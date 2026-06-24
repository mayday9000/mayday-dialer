import { NextResponse, after } from "next/server";
import twilio from "twilio";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { callLogs, callTranscripts } from "@/lib/db/schema";
import { autoEngine, getTranscriptionEngine } from "@/lib/transcription";
import { transcriptPatchFromResult } from "@/lib/transcripts";
import { applyCallNotes } from "@/lib/ai/call-notes";

export const runtime = "nodejs";
// Transcription runs in after() (post-response). Give it headroom; Deepgram is
// faster than realtime, so even long calls finish well within this.
export const maxDuration = 60;

/**
 * Twilio recording-status callback (POST). Fires once a call's dual-channel
 * recording is ready. We persist the recording SID on the matching call log,
 * create/locate a transcript row (keyed by CallSid so it lines up with the
 * in-browser outcome logging regardless of arrival order), and — when an auto
 * engine is configured — kick off transcription.
 *
 * leadId/userId ride in via the callback URL query (set by the voice webhook),
 * since Twilio doesn't echo custom call params to recording callbacks.
 */
export async function POST(req: Request) {
  const form = await req.formData();
  const params: Record<string, string> = {};
  form.forEach((v, k) => (params[k] = String(v)));

  const incoming = new URL(req.url);
  const rawLeadId = incoming.searchParams.get("leadId") || "";
  const queryUserId = (incoming.searchParams.get("userId") || "").slice(0, 128);
  // Only trust a UUID-shaped leadId (it came from our own callback URL, but the
  // value originates client-side via connect params).
  const queryLeadId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rawLeadId)
    ? rawLeadId
    : "";

  // This webhook writes to the DB and triggers paid transcription, so it must
  // be authenticated. Without a token we can't verify Twilio's signature →
  // refuse rather than act on unverifiable, attacker-controllable input.
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!authToken) return new NextResponse("Not configured", { status: 503 });
  const signature = req.headers.get("x-twilio-signature") || "";
  const envBase = process.env.TWILIO_VOICE_URL
    ? process.env.TWILIO_VOICE_URL.replace(/\/voice\/?$/, "/recording") + incoming.search
    : null;
  const ok =
    (!!envBase && twilio.validateRequest(authToken, signature, envBase, params)) ||
    twilio.validateRequest(authToken, signature, req.url, params);
  if (!ok) return new NextResponse("Invalid signature", { status: 403 });

  const recordingSid = params.RecordingSid || "";
  const callSid = params.CallSid || "";
  const status = params.RecordingStatus || "";
  const durationSec = params.RecordingDuration ? parseInt(params.RecordingDuration, 10) : null;

  // Defense in depth: RecordingSid flows into Twilio media URLs downstream, so
  // only accept well-formed Twilio SIDs.
  if (status !== "completed" || !/^RE[a-zA-Z0-9]+$/.test(recordingSid)) {
    return NextResponse.json({ ok: true, skipped: status || "no-recording" });
  }
  if (callSid && !/^CA[a-zA-Z0-9]+$/.test(callSid)) {
    return new NextResponse("Bad CallSid", { status: 400 });
  }

  // Best-effort: stamp the recording onto the matching call log.
  let leadId = queryLeadId;
  if (callSid) {
    const matched = await db
      .update(callLogs)
      .set({ recordingSid, recordingDurationSec: durationSec ?? undefined })
      .where(eq(callLogs.providerCallSid, callSid))
      .returning({ id: callLogs.id, leadId: callLogs.leadId });
    if (!leadId && matched[0]?.leadId) leadId = matched[0].leadId;
  }

  // Without a lead we can't store a transcript (leadId is required); the
  // recording still lives on Twilio and on the call log if it matched.
  if (!leadId) return NextResponse.json({ ok: true, recording: recordingSid, transcript: false });

  const engine = getTranscriptionEngine();
  const source = autoEngine() ?? "manual";

  // Upsert a transcript row by CallSid (no interactive txns on neon-http, so
  // select-then-write; a duplicate "completed" event is the only race and is
  // idempotent enough here).
  const existing = callSid
    ? await db.select({ id: callTranscripts.id }).from(callTranscripts).where(eq(callTranscripts.callSid, callSid)).limit(1)
    : [];

  let transcriptId: string;
  if (existing[0]) {
    transcriptId = existing[0].id;
    await db
      .update(callTranscripts)
      .set({ recordingSid, recordingDurationSec: durationSec ?? undefined, source, status: engine ? "processing" : "pending", updatedAt: new Date() })
      .where(eq(callTranscripts.id, transcriptId));
  } else {
    const [row] = await db
      .insert(callTranscripts)
      .values({
        leadId,
        userId: queryUserId || null,
        callSid: callSid || null,
        source,
        status: engine ? "processing" : "pending",
        recordingSid,
        recordingDurationSec: durationSec,
      })
      .returning({ id: callTranscripts.id });
    transcriptId = row.id;
  }

  // Link to the call log if it exists already (else logCallOutcome links later).
  if (callSid) {
    const log = await db
      .select({ id: callLogs.id })
      .from(callLogs)
      .where(eq(callLogs.providerCallSid, callSid))
      .limit(1);
    if (log[0]) {
      await db
        .update(callTranscripts)
        .set({ callLogId: log[0].id, updatedAt: new Date() })
        .where(and(eq(callTranscripts.id, transcriptId), isNull(callTranscripts.callLogId)));
    }
  }

  // Auto-transcribe AFTER responding, so Twilio gets a fast 200 (its webhook
  // times out ~15s) while Deepgram download+transcribe runs post-response.
  // Sync engines (Deepgram) finish here; async engines (Twilio VI) kick off and
  // are polled later. Failures are recorded but never fatal — the recording is
  // preserved and can be retried from the UI.
  if (engine) {
    after(async () => {
      try {
        if (engine.kind === "sync" && engine.transcribe) {
          const result = await engine.transcribe({ recordingSid });
          await db
            .update(callTranscripts)
            .set(transcriptPatchFromResult(result))
            .where(eq(callTranscripts.id, transcriptId));
          // The payoff: write the rep's notes automatically from the transcript.
          if (result.status === "completed") await applyCallNotes(transcriptId);
        } else if (engine.start) {
          const { providerTranscriptSid } = await engine.start({ recordingSid });
          await db
            .update(callTranscripts)
            .set({ providerTranscriptSid, status: "processing", updatedAt: new Date() })
            .where(eq(callTranscripts.id, transcriptId));
        }
      } catch (e) {
        await db
          .update(callTranscripts)
          .set({ status: "failed", error: e instanceof Error ? e.message : "transcription failed", updatedAt: new Date() })
          .where(eq(callTranscripts.id, transcriptId));
      }
    });
  }

  return NextResponse.json({ ok: true, recording: recordingSid, transcript: transcriptId });
}
