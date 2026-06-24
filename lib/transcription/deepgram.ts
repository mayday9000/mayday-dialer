/**
 * Deepgram adapter (synchronous, prerecorded API).
 *
 * Flow: pull the Twilio dual-channel recording (Basic auth) → POST the bytes to
 * Deepgram with multichannel=true → each channel is its own speaker, so we get
 * clean agent/prospect attribution without diarization guesswork. One round
 * trip, result returned immediately (no polling).
 *
 * Docs: https://developers.deepgram.com/docs/pre-recorded-audio
 */
import type { TranscriptSegment } from "@/lib/db/schema";
import type { TranscriptionEngine, TranscriptionResult } from "./types";
import { transcriptionConfig } from "./config";

const DG_BASE = "https://api.deepgram.com/v1/listen";

function twilioAuth(): string {
  const sid = transcriptionConfig.twilioAccountSid ?? "";
  const token = transcriptionConfig.twilioAuthToken ?? "";
  return "Basic " + Buffer.from(`${sid}:${token}`).toString("base64");
}

type DgWord = { word?: string; start?: number; end?: number; confidence?: number };
type DgUtterance = {
  start?: number;
  end?: number;
  confidence?: number;
  channel?: number;
  transcript?: string;
};
type DgAlt = { transcript?: string; confidence?: number; words?: DgWord[] };
type DgResponse = {
  results?: {
    utterances?: DgUtterance[];
    channels?: { alternatives?: DgAlt[] }[];
  };
  metadata?: { detected_language?: string };
};

export const deepgram: TranscriptionEngine = {
  kind: "sync",

  async transcribe({ recordingSid }): Promise<TranscriptionResult> {
    const apiKey = transcriptionConfig.deepgramApiKey;
    if (!apiKey) return { status: "failed", segments: [], text: "", error: "DEEPGRAM_API_KEY not set" };

    // 1) Fetch the recording bytes from Twilio (the .mp3 is protected).
    const accountSid = transcriptionConfig.twilioAccountSid;
    const recUrl = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Recordings/${recordingSid}.mp3`;
    const audio = await fetch(recUrl, { headers: { Authorization: twilioAuth() } });
    if (!audio.ok) {
      return { status: "failed", segments: [], text: "", error: `recording fetch failed (${audio.status})` };
    }
    const bytes = Buffer.from(await audio.arrayBuffer());

    // 2) Transcribe. multichannel=true → per-channel transcripts (speakers);
    //    utterances=true → ready-made, timestamped segments.
    const params = new URLSearchParams({
      model: transcriptionConfig.deepgramModel,
      multichannel: "true",
      utterances: "true",
      punctuate: "true",
      smart_format: "true",
    });
    const dg = await fetch(`${DG_BASE}?${params.toString()}`, {
      method: "POST",
      headers: { Authorization: `Token ${apiKey}`, "Content-Type": "audio/mpeg" },
      body: bytes,
    });
    if (!dg.ok) {
      const detail = await dg.text().catch(() => "");
      return { status: "failed", segments: [], text: "", error: `deepgram (${dg.status}): ${detail.slice(0, 160)}` };
    }
    const data = (await dg.json()) as DgResponse;

    // Deepgram channel index is 0-based; map to Twilio's 1-based agentChannel.
    const agentIdx = transcriptionConfig.agentChannel - 1;
    const speakerFor = (ch: number | undefined): TranscriptSegment["speaker"] =>
      ch == null ? "unknown" : ch === agentIdx ? "agent" : "prospect";

    let segments: TranscriptSegment[] = [];
    const utterances = data.results?.utterances ?? [];
    if (utterances.length) {
      segments = utterances
        .slice()
        .sort((a, b) => (a.start ?? 0) - (b.start ?? 0))
        .map((u) => ({
          speaker: speakerFor(u.channel),
          text: (u.transcript ?? "").trim(),
          startMs: u.start != null ? Math.round(u.start * 1000) : undefined,
          endMs: u.end != null ? Math.round(u.end * 1000) : undefined,
          confidence: u.confidence,
        }))
        .filter((s) => s.text);
    } else {
      // Fallback: one segment per channel from the channel transcript.
      segments = (data.results?.channels ?? [])
        .map((c, i) => {
          const alt = c.alternatives?.[0];
          return {
            speaker: speakerFor(i),
            text: (alt?.transcript ?? "").trim(),
            confidence: alt?.confidence,
          } as TranscriptSegment;
        })
        .filter((s) => s.text);
    }

    const text = segments.map((s) => s.text).join(" ");
    return {
      status: "completed",
      segments,
      text,
      language: data.metadata?.detected_language ?? null,
    };
  },
};
