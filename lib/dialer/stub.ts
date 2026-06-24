import type { Dialer, CallStatus, DialerOptions, CallMeta } from "./types";

/**
 * Simulated dialer. No credentials, no audio — it drives the same status
 * transitions a real call would, so the entire dial session UX (auto-advance,
 * notes, outcome logging) is testable before Twilio is wired up.
 *
 * Most calls "connect"; a minority simulate no-answer/voicemail so outcome
 * logging gets exercised. The simulated path is deterministic per-number-ish
 * to avoid flakiness but still varied.
 */
export class StubDialer implements Dialer {
  readonly provider = "stub" as const;
  readonly isStub = true;

  private _status: CallStatus = "uninitialized";
  private muted = false;
  private timers: ReturnType<typeof setTimeout>[] = [];
  private callStartedAt = 0;
  private opts: DialerOptions;
  private callSeq = 0;

  constructor(opts: DialerOptions = {}) {
    this.opts = opts;
  }

  status() {
    return this._status;
  }

  private set(status: CallStatus, detail?: string) {
    this._status = status;
    this.opts.onStatus?.(status, detail);
  }

  private clearTimers() {
    this.timers.forEach(clearTimeout);
    this.timers = [];
  }

  private after(ms: number, fn: () => void) {
    this.timers.push(setTimeout(fn, ms));
  }

  async init() {
    this.set("initializing", "Starting simulated device");
    await new Promise((r) => setTimeout(r, 150));
    this.set("ready", "Simulated dialer ready");
  }

  async call(toE164: string, _meta?: CallMeta) {
    void _meta;
    this.clearTimers();
    this.muted = false;
    const seq = ++this.callSeq;
    this.set("connecting", `Dialing ${toE164} (simulated)`);

    this.after(900, () => {
      this.set("ringing", "Ringing…");

      // Every 4th simulated call doesn't connect, to exercise outcomes.
      const noAnswer = seq % 4 === 0;
      if (noAnswer) {
        this.after(3500, () => {
          this.set("ended", "No answer (simulated)");
          this.opts.onCallEnded?.({ durationSec: 0, suggestedOutcome: "no_answer" });
        });
      } else {
        this.after(1800, () => {
          this.callStartedAt = Date.now();
          this.set("active", "Connected (simulated) — talk through your headset");
        });
      }
    });
  }

  hangup() {
    this.clearTimers();
    const wasActive = this._status === "active";
    const durationSec = wasActive ? Math.round((Date.now() - this.callStartedAt) / 1000) : 0;
    this.set("ended", "Call ended");
    this.opts.onCallEnded?.({
      durationSec,
      suggestedOutcome: wasActive ? "connected" : undefined,
    });
  }

  setMuted(muted: boolean) {
    this.muted = muted;
  }

  isMuted() {
    return this.muted;
  }

  sendDigits(digits: string) {
    if (this._status === "active") this.set("active", `Tone sent: ${digits} (simulated)`);
  }

  destroy() {
    this.clearTimers();
    this._status = "uninitialized";
  }
}
