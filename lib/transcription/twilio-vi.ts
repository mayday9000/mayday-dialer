/**
 * Twilio Voice Intelligence adapter (REST, no SDK namespace dependency).
 *
 * Flow: create a Transcript from a recording SID → Twilio transcribes async →
 * we poll the Transcript status and, when complete, pull Sentences (which are
 * speaker/channel separated thanks to dual-channel recording).
 *
 * Docs: https://www.twilio.com/docs/voice/intelligence
 */
import type { TranscriptSegment } from "@/lib/db/schema";
import type { TranscriptionEngine, TranscriptionResult } from "./types";
import { transcriptionConfig } from "./config";

const BASE = "https://intelligence.twilio.com/v2";

function authHeader(): string {
  const sid = transcriptionConfig.twilioAccountSid ?? "";
  const token = transcriptionConfig.twilioAuthToken ?? "";
  return "Basic " + Buffer.from(`${sid}:${token}`).toString("base64");
}

type ViSentence = {
  media_channel?: number;
  channel?: number;
  sentence_index?: number;
  transcript?: string;
  confidence?: number;
  start_time?: number; // seconds
  end_time?: number;
};

function mapStatus(s: string | undefined): TranscriptionResult["status"] {
  if (s === "completed") return "completed";
  if (s === "failed" || s === "canceled") return "failed";
  return "processing"; // queued | in-progress
}

export const twilioVoiceIntelligence: TranscriptionEngine = {
  kind: "async",
  async start({ recordingSid }) {
    const body = new URLSearchParams();
    body.set("ServiceSid", transcriptionConfig.viServiceSid ?? "");
    body.set("Channel", JSON.stringify({ media_properties: { source_sid: recordingSid } }));

    const res = await fetch(`${BASE}/Transcripts`, {
      method: "POST",
      headers: {
        Authorization: authHeader(),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`Voice Intelligence create failed (${res.status}): ${detail.slice(0, 200)}`);
    }
    const data = (await res.json()) as { sid?: string };
    if (!data.sid) throw new Error("Voice Intelligence did not return a transcript SID");
    return { providerTranscriptSid: data.sid };
  },

  async fetch(providerTranscriptSid): Promise<TranscriptionResult> {
    const head = await fetch(`${BASE}/Transcripts/${providerTranscriptSid}`, {
      headers: { Authorization: authHeader() },
    });
    if (!head.ok) {
      const detail = await head.text().catch(() => "");
      return { status: "failed", segments: [], text: "", error: `fetch failed (${head.status}): ${detail.slice(0, 160)}` };
    }
    const meta = (await head.json()) as { status?: string; language_code?: string };
    const status = mapStatus(meta.status);
    if (status !== "completed") {
      return { status, segments: [], text: "", language: meta.language_code ?? null };
    }

    // Completed → page through sentences.
    const sentences: ViSentence[] = [];
    let url: string | null = `${BASE}/Transcripts/${providerTranscriptSid}/Sentences?PageSize=200`;
    let guard = 0;
    while (url && guard++ < 25) {
      const r: Response = await fetch(url, { headers: { Authorization: authHeader() } });
      if (!r.ok) break;
      const page = (await r.json()) as { sentences?: ViSentence[]; meta?: { next_page_url?: string | null } };
      if (page.sentences) sentences.push(...page.sentences);
      url = page.meta?.next_page_url ?? null;
    }

    sentences.sort((a, b) => (a.sentence_index ?? 0) - (b.sentence_index ?? 0));
    const agentChannel = transcriptionConfig.agentChannel;
    const segments: TranscriptSegment[] = sentences.map((s) => {
      const ch = s.media_channel ?? s.channel;
      const speaker: TranscriptSegment["speaker"] =
        ch == null ? "unknown" : ch === agentChannel ? "agent" : "prospect";
      return {
        speaker,
        text: (s.transcript ?? "").trim(),
        startMs: s.start_time != null ? Math.round(s.start_time * 1000) : undefined,
        endMs: s.end_time != null ? Math.round(s.end_time * 1000) : undefined,
        confidence: s.confidence,
      };
    }).filter((s) => s.text);

    const text = segments.map((s) => s.text).join(" ");
    return { status: "completed", segments, text, language: meta.language_code ?? null };
  },
};
