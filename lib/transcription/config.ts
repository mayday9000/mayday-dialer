/**
 * Env-driven config for the call-transcription pipeline. One place to read, so
 * routes/actions don't sprinkle process.env around. Everything degrades: if no
 * engine is configured, recordings are still stored and manual transcripts work.
 */
import type { TranscriptSource } from "@/lib/db/schema";

export const transcriptionConfig = {
  // Master switch for recording calls (prerequisite for any audio transcript).
  recordCalls: process.env.TWILIO_RECORD === "true",

  // Which engine fills transcripts automatically. "manual" = no auto engine.
  provider: (process.env.TRANSCRIPTION_PROVIDER || "manual") as TranscriptSource,

  // Twilio Voice Intelligence: a Service SID (GA…) + the account creds the rest
  // of the Twilio integration already uses.
  twilioAccountSid: process.env.TWILIO_ACCOUNT_SID || null,
  twilioAuthToken: process.env.TWILIO_AUTH_TOKEN || null,
  viServiceSid: process.env.TWILIO_INTELLIGENCE_SERVICE_SID || null,

  // Deepgram (bring-your-own ASR): just an API key. Transcribes the Twilio
  // recording synchronously with per-channel speaker separation. Cheapest +
  // easiest auto path (no console service to create).
  deepgramApiKey: process.env.DEEPGRAM_API_KEY || null,
  deepgramModel: process.env.DEEPGRAM_MODEL || "nova-2",

  // record-from-answer-dual puts each leg on its own channel. Which channel is
  // the agent (your browser leg) vs the prospect. Twilio's default for an
  // outbound <Dial> is channel 1 = parent (you), channel 2 = dialed party.
  agentChannel: Number(process.env.TWILIO_AGENT_CHANNEL || 1),
};

export function isViConfigured(): boolean {
  return !!(
    transcriptionConfig.viServiceSid &&
    transcriptionConfig.twilioAccountSid &&
    transcriptionConfig.twilioAuthToken
  );
}

export function isDeepgramConfigured(): boolean {
  return !!(transcriptionConfig.deepgramApiKey && transcriptionConfig.twilioAccountSid);
}

/**
 * The engine we'll actually use for a fresh recording (or null = none).
 * Honors TRANSCRIPTION_PROVIDER, then falls back to whatever's configured —
 * so setting just DEEPGRAM_API_KEY is enough to make transcription automatic.
 */
export function autoEngine(): TranscriptSource | null {
  const p = transcriptionConfig.provider;
  if (p === "deepgram" && isDeepgramConfigured()) return "deepgram";
  if (p === "twilio_voice_intelligence" && isViConfigured()) return "twilio_voice_intelligence";
  if (isDeepgramConfigured()) return "deepgram";
  if (isViConfigured()) return "twilio_voice_intelligence";
  return null;
}
