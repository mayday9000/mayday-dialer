import type { CallOutcome, LeadStatus } from "@/lib/db/schema";

// Statuses worth dialing. Booked / do-not-call / not-interested / bad / closed
// are skipped so the auto-dialer never surfaces them. Shared by the dial queue
// and the cron auto-top-up so they always agree.
export const DIALABLE_STATUSES: LeadStatus[] = ["new", "in_progress", "contacted", "callback"];

// How long a rep's dial lease on a lead holds before auto-expiring (multi-rep).
export const CLAIM_TTL_MS = 10 * 60 * 1000;

const DAY_MS = 24 * 60 * 60 * 1000;

// Outcomes that mean "we didn't actually reach them." These drive the escalating
// rest below so the same number isn't re-dialed day after day. Outcomes that
// reach a person (connected/booked) or resolve the lead (not_interested/DNC/etc.)
// are intentionally excluded — the latter already leave DIALABLE_STATUSES.
export const NO_CONTACT_OUTCOMES = new Set<CallOutcome>([
  "no_answer",
  "busy",
  "voicemail",
  "gatekeeper",
  "mailbox_full",
  "bad_connection",
]);

// Gentle escalating backoff: after each no-contact attempt the lead "rests"
// longer before it resurfaces in the queue. Index = number of no-contact
// attempts so far (1st → 2 days, 2nd → 3, 3rd → 5, 4th+ → 7). Kept gentle on
// purpose so leads stay in rotation while the pool is thin — tune here.
const BACKOFF_DAYS = [2, 3, 5, 7];

/**
 * How long a lead should rest (stay out of the dial queue) after its most recent
 * call, given how many no-contact attempts it's had and that call's outcome.
 * Any non-no-contact outcome (you reached them, set a callback, etc.) keeps just
 * the 1-day floor, so you never re-dial the same number twice in one day, but a
 * fresh conversation resets the escalation. Returns milliseconds.
 */
export function restMsFor(
  noContactAttempts: number,
  latestOutcome: CallOutcome | string | null,
): number {
  if (!latestOutcome || !NO_CONTACT_OUTCOMES.has(latestOutcome as CallOutcome)) return DAY_MS;
  const i = Math.min(Math.max(noContactAttempts, 1), BACKOFF_DAYS.length) - 1;
  return BACKOFF_DAYS[i] * DAY_MS;
}

// Call outcomes the caller can log, with display label and the lead status
// each one implies (pre-selected, but the caller can override).
export const OUTCOMES: {
  value: CallOutcome;
  label: string;
  status: LeadStatus;
  tone: "good" | "neutral" | "bad";
}[] = [
  { value: "booked", label: "Booked meeting", status: "booked", tone: "good" },
  { value: "connected", label: "Connected", status: "contacted", tone: "good" },
  { value: "callback", label: "Call back later", status: "callback", tone: "neutral" },
  { value: "voicemail", label: "Left voicemail", status: "contacted", tone: "neutral" },
  { value: "no_answer", label: "No answer", status: "in_progress", tone: "neutral" },
  { value: "busy", label: "Busy", status: "in_progress", tone: "neutral" },
  { value: "gatekeeper", label: "Gatekeeper", status: "in_progress", tone: "neutral" },
  { value: "not_interested", label: "Not interested", status: "not_interested", tone: "bad" },
  { value: "wrong_number", label: "Wrong number", status: "bad_number", tone: "bad" },
  { value: "do_not_call", label: "Do not call", status: "do_not_call", tone: "bad" },
  // Retry-later outcomes — couldn't leave a message / bad call quality.
  { value: "mailbox_full", label: "Mailbox full", status: "in_progress", tone: "neutral" },
  { value: "bad_connection", label: "Couldn't hear me", status: "in_progress", tone: "neutral" },
];

export function outcomeLabel(value: string | null | undefined): string {
  return OUTCOMES.find((o) => o.value === value)?.label ?? value ?? "";
}
