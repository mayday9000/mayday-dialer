/**
 * Engine dispatch. Pick the configured transcription engine, or null when none
 * is set up (recordings still get stored; transcripts can be entered manually).
 *
 * Adding Deepgram/Whisper later = implement TranscriptionEngine and add a case.
 */
import type { TranscriptionEngine } from "./types";
import { autoEngine } from "./config";
import { twilioVoiceIntelligence } from "./twilio-vi";
import { deepgram } from "./deepgram";

export * from "./config";
export type { TranscriptionEngine, TranscriptionResult } from "./types";

export function getTranscriptionEngine(): TranscriptionEngine | null {
  switch (autoEngine()) {
    case "deepgram":
      return deepgram;
    case "twilio_voice_intelligence":
      return twilioVoiceIntelligence;
    default:
      return null;
  }
}
