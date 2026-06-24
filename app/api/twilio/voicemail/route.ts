import { NextResponse, after } from "next/server";
import twilio from "twilio";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { leads, leadEvents, voicemails, campaignNumbers, campaignLeads } from "@/lib/db/schema";
import { normalizePhone } from "@/lib/phone";
import { getTranscriptionEngine } from "@/lib/transcription";

export const runtime = "nodejs";

/**
 * <Record> action for inbound voicemail (a prospect calling a city number back).
 * Captures EVERY voicemail in the `voicemails` inbox — matched to a lead by
 * phone when possible, but unknown callers are kept too (nothing dropped) —
 * transcribes the recording with the same engine as call recordings, and (for
 * known callers) still files a voicemail entry on the lead's timeline.
 */
export async function POST(req: Request) {
  const form = await req.formData();
  const from = String(form.get("From") || "");
  const to = String(form.get("To") || ""); // the city number they called
  const recordingUrl = String(form.get("RecordingUrl") || "");
  const recordingSid = String(form.get("RecordingSid") || "");
  const durationSec = parseInt(String(form.get("RecordingDuration") || "0"), 10) || 0;

  if (recordingUrl) {
    const norm = normalizePhone(from);
    const lead = norm
      ? await db.query.leads.findFirst({ where: eq(leads.phoneNormalized, norm) })
      : null;

    // Resolve which campaign/city the called number belongs to (for inbox context).
    let campaignId: string | null = null;
    let marketId: string | null = null;
    if (to) {
      const [num] = await db
        .select({ campaignId: campaignNumbers.campaignId, marketId: campaignNumbers.marketId })
        .from(campaignNumbers)
        .where(eq(campaignNumbers.e164, to))
        .limit(1);
      if (num) {
        campaignId = num.campaignId ?? null;
        marketId = num.marketId ?? null;
      }
    }
    // Fall back to the matched lead's own campaign/city membership.
    if (lead && (!campaignId || !marketId)) {
      const [cl] = await db
        .select({ campaignId: campaignLeads.campaignId, marketId: campaignLeads.marketId })
        .from(campaignLeads)
        .where(eq(campaignLeads.leadId, lead.id))
        .limit(1);
      if (cl) {
        campaignId = campaignId ?? cl.campaignId;
        marketId = marketId ?? cl.marketId;
      }
    }

    const engine = getTranscriptionEngine();
    const willTranscribe = !!recordingSid && engine?.kind === "sync" && !!engine.transcribe;

    const [vm] = await db
      .insert(voicemails)
      .values({
        leadId: lead?.id ?? null,
        campaignId,
        marketId,
        fromPhone: from || null,
        fromNormalized: norm,
        toNumber: to || null,
        recordingSid: recordingSid || null,
        recordingUrl: recordingUrl || null,
        durationSec,
        transcriptStatus: willTranscribe ? "processing" : "skipped",
      })
      .returning({ id: voicemails.id });

    // Keep the lead-timeline entry for known callers (the lead detail page renders it).
    if (lead) {
      await db.insert(leadEvents).values({
        leadId: lead.id,
        type: "voicemail",
        body: `Voicemail (${durationSec}s)`,
        metadata: { recordingSid, recordingUrl, durationSec, from, voicemailId: vm?.id },
      });
    }

    // Transcribe AFTER responding to Twilio so the caller isn't kept waiting.
    if (willTranscribe && vm?.id) {
      const vmId = vm.id;
      after(async () => {
        try {
          const result = await engine!.transcribe!({ recordingSid });
          await db
            .update(voicemails)
            .set({
              transcriptStatus: result.status === "completed" ? "completed" : "failed",
              transcriptText: result.text || null,
            })
            .where(eq(voicemails.id, vmId));
        } catch {
          await db
            .update(voicemails)
            .set({ transcriptStatus: "failed" })
            .where(eq(voicemails.id, vmId))
            .catch(() => {});
        }
      });
    }
  }

  const VoiceResponse = twilio.twiml.VoiceResponse;
  const twiml = new VoiceResponse();
  twiml.say("Thanks — we'll be in touch shortly. Goodbye.");
  twiml.hangup();
  return new NextResponse(twiml.toString(), { headers: { "Content-Type": "text/xml" } });
}
