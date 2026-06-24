// Provider-agnostic browser dialer abstraction.
//
// The dial UI talks ONLY to this interface, so swapping Twilio for another
// provider (or the stub) never touches the UI. Two implementations ship:
//   - StubDialer:   simulates the full call lifecycle with timers, no creds,
//                   no audio. Lets the whole calling loop be tested today.
//   - TwilioDialer: wraps @twilio/voice-sdk Device for real WebRTC calls.

export type CallStatus =
  | "uninitialized"
  | "initializing"
  | "ready" // device registered, no active call
  | "connecting" // dial requested
  | "ringing"
  | "active" // connected, talking
  | "ended"
  | "error";

export type DialerProviderName = "stub" | "twilio";

export interface DialerEvents {
  /** Fired on every status transition. `detail` is human-readable context. */
  onStatus?: (status: CallStatus, detail?: string) => void;
  /** Fired when a call ends, with a best-effort suggested outcome. The Twilio
   *  CallSid (when known) lets the logged outcome line up with the server-side
   *  recording + transcript for the same call. */
  onCallEnded?: (info: { durationSec: number; suggestedOutcome?: string; callSid?: string }) => void;
  onError?: (message: string) => void;
}

/** Extra context passed when placing a call. `leadId` attributes the
 *  recording/transcript server-side; `campaignId`/`marketId` let the TwiML
 *  webhook pick the city's local caller ID (the number is re-derived
 *  server-side, never trusted from these params). */
export type CallMeta = { leadId?: string; campaignId?: string; marketId?: string };

export interface Dialer {
  readonly provider: DialerProviderName;
  /** True if this is the simulated dialer (UI shows a "simulated" badge). */
  readonly isStub: boolean;

  /** Register the underlying device. Safe to call once. */
  init(): Promise<void>;
  /** Place an outbound call to an E.164 number. `meta.leadId` is forwarded to
   *  the TwiML webhook so the recording can be attributed to the lead. */
  call(toE164: string, meta?: CallMeta): Promise<void>;
  /** End the current call. */
  hangup(): void;
  /** Mute/unmute the local mic. */
  setMuted(muted: boolean): void;
  isMuted(): boolean;
  /** Send DTMF tones during an active call (phone-tree / extension navigation). */
  sendDigits(digits: string): void;
  /** Tear down the device and listeners. */
  destroy(): void;

  status(): CallStatus;
}

export type DialerOptions = DialerEvents & {
  /** Used by Twilio as the device identity / token subject. */
  identity?: string;
  /** Endpoint that mints provider access tokens (Twilio). */
  tokenUrl?: string;
};
