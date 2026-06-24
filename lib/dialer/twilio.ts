import type { Dialer, CallStatus, DialerOptions, CallMeta } from "./types";
import type { Device as TwilioDevice, Call as TwilioCall } from "@twilio/voice-sdk";

/** Plain-English text for Twilio Voice's cryptic numeric error codes. */
function describeTwilioError(e: { code?: number; message?: string }): string {
  switch (e?.code) {
    case 31000:
    case 31003:
    case 31005:
      return "Call dropped before connecting — the number may be unreachable, or a brief network hiccup. Try again.";
    case 31486:
      return "That line is busy.";
    case 21211:
    case 21217:
    case 13223:
    case 13224:
      return "That number isn't dialable (invalid or not permitted).";
    case 31208:
    case 31402:
      return "Microphone access is blocked — allow it in the browser and try again.";
    default:
      return e?.message || "Call error";
  }
}

/**
 * Real browser calling via Twilio Voice SDK. Audio flows through the user's
 * headset over WebRTC. Requires the server token endpoint + a configured
 * TwiML app (see app/api/twilio/*).
 *
 * The SDK is imported dynamically so it never runs during SSR.
 */
export class TwilioDialer implements Dialer {
  readonly provider = "twilio" as const;
  readonly isStub = false;

  private _status: CallStatus = "uninitialized";
  private device: TwilioDevice | null = null;
  private activeCall: TwilioCall | null = null;
  private activeCallSid: string | null = null;
  private muted = false;
  private callStartedAt = 0;
  private opts: DialerOptions;

  constructor(opts: DialerOptions) {
    this.opts = opts;
  }

  status() {
    return this._status;
  }

  private set(status: CallStatus, detail?: string) {
    this._status = status;
    this.opts.onStatus?.(status, detail);
  }

  private async fetchToken(): Promise<string> {
    const res = await fetch(this.opts.tokenUrl ?? "/api/twilio/token", { method: "POST" });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `Token request failed (${res.status})`);
    }
    const data = await res.json();
    return data.token as string;
  }

  async init() {
    if (this.device) return;
    this.set("initializing", "Connecting to Twilio");
    try {
      const { Device } = await import("@twilio/voice-sdk");
      const token = await this.fetchToken();
      const device = new Device(token, { logLevel: "error" });

      device.on("registered", () => this.set("ready", "Ready to call"));
      device.on("error", async (e: { message?: string; code?: number }) => {
        // 20104 = access token expired/invalid. Recover by minting a fresh one
        // instead of surfacing a dead-end error to the caller.
        if (e?.code === 20104) {
          try {
            device.updateToken(await this.fetchToken());
            return;
          } catch {
            /* fall through to surface */
          }
        }
        this.opts.onError?.(describeTwilioError(e));
      });
      device.on("tokenWillExpire", async () => {
        try {
          device.updateToken(await this.fetchToken());
        } catch {
          /* surfaced on next call */
        }
      });

      this.device = device;
      await device.register();
    } catch (e) {
      this.set("error", e instanceof Error ? e.message : "Failed to initialize Twilio");
      this.opts.onError?.(e instanceof Error ? e.message : "Failed to initialize Twilio");
    }
  }

  async call(toE164: string, meta?: CallMeta) {
    if (!this.device) await this.init();
    if (!this.device) return;

    // Refresh the token right before dialing — covers the case where the tab
    // slept past the refresh window or a background refresh failed, so an
    // expired token never blocks a call.
    try {
      this.device.updateToken(await this.fetchToken());
    } catch {
      /* if this fails, connect() will surface the hard error */
    }

    this.muted = false;
    this.activeCallSid = null;
    this.set("connecting", `Dialing ${toE164}`);
    try {
      // leadId rides along to the TwiML webhook so the recording-status
      // callback can attribute the recording to this lead server-side.
      // campaignId/marketId let the webhook pick this city's local caller ID.
      const call = await this.device.connect({
        params: {
          To: toE164,
          leadId: meta?.leadId ?? "",
          campaignId: meta?.campaignId ?? "",
          marketId: meta?.marketId ?? "",
        },
      });
      this.activeCall = call;

      // The parent CallSid (same one the recording callback reports) becomes
      // available once the call is set up; grab it best-effort.
      const captureSid = () => {
        const sid = (call as unknown as { parameters?: Record<string, string> }).parameters?.CallSid;
        if (sid) this.activeCallSid = sid;
      };

      call.on("ringing", () => {
        captureSid();
        this.set("ringing", "Ringing…");
      });
      call.on("accept", () => {
        captureSid();
        this.callStartedAt = Date.now();
        this.set("active", "Connected");
      });
      call.on("disconnect", () => this.handleEnded("connected"));
      call.on("cancel", () => this.handleEnded());
      call.on("reject", () => this.handleEnded());
      call.on("error", (e: { message?: string; code?: number }) => {
        this.opts.onError?.(describeTwilioError(e));
        this.handleEnded();
      });
    } catch (e) {
      this.set("error", e instanceof Error ? e.message : "Failed to place call");
      this.opts.onError?.(e instanceof Error ? e.message : "Failed to place call");
    }
  }

  private handleEnded(suggestedOutcome?: string) {
    const durationSec = this.callStartedAt
      ? Math.round((Date.now() - this.callStartedAt) / 1000)
      : 0;
    const callSid = this.activeCallSid ?? undefined;
    this.callStartedAt = 0;
    this.activeCall = null;
    this.activeCallSid = null;
    this.set("ended", "Call ended");
    this.opts.onCallEnded?.({
      durationSec,
      suggestedOutcome: durationSec > 0 ? suggestedOutcome ?? "connected" : undefined,
      callSid,
    });
  }

  hangup() {
    if (this.activeCall) this.activeCall.disconnect();
    else this.device?.disconnectAll();
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    this.activeCall?.mute(muted);
  }

  isMuted() {
    return this.muted;
  }

  sendDigits(digits: string) {
    this.activeCall?.sendDigits(digits);
  }

  destroy() {
    try {
      this.activeCall?.disconnect();
      this.device?.destroy();
    } catch {
      /* ignore */
    }
    this.activeCall = null;
    this.device = null;
    this._status = "uninitialized";
  }
}
