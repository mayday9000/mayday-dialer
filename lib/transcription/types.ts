import type { TranscriptSegment, TranscriptStatus } from "@/lib/db/schema";

/** What an engine returns when we poll/fetch/transcribe. */
export type TranscriptionResult = {
  status: TranscriptStatus;
  segments: TranscriptSegment[];
  text: string;
  language?: string | null;
  error?: string | null;
};

/**
 * A pluggable transcription engine.
 * - "sync" engines (Deepgram/Whisper): implement `transcribe()` — fetch the
 *   recording, transcribe, and return a finished result in one call.
 * - "async" engines (Twilio Voice Intelligence): implement `start()` + `fetch()`
 *   — kick off, then poll until complete.
 */
export interface TranscriptionEngine {
  kind: "sync" | "async";
  transcribe?(input: { recordingSid: string; languageCode?: string }): Promise<TranscriptionResult>;
  start?(input: { recordingSid: string; languageCode?: string }): Promise<{ providerTranscriptSid: string }>;
  fetch?(providerTranscriptSid: string): Promise<TranscriptionResult>;
}
