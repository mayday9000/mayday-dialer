/**
 * Open-now computation from structured weekly hours + the business's timezone,
 * and a best-effort parser for hours typed manually during a call.
 * Client-safe (no server-only imports).
 */
import type { DayPeriod } from "@/lib/db/schema";

export type OpenState = "open" | "closed" | "unknown";

const WD: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** Is the business open at `nowMs`, given structured `periods` + its IANA tz? */
export function openStateFromHours(
  periods: DayPeriod[] | null | undefined,
  tz: string | null,
  nowMs: number,
): OpenState {
  if (!periods || !periods.length || !tz) return "unknown";
  let wd: number;
  let cur: number;
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(new Date(nowMs));
    const w = parts.find((p) => p.type === "weekday")?.value ?? "";
    let hh = parts.find((p) => p.type === "hour")?.value ?? "00";
    if (hh === "24") hh = "00";
    const mm = parts.find((p) => p.type === "minute")?.value ?? "00";
    wd = WD[w] ?? -1;
    cur = parseInt(hh + mm, 10);
  } catch {
    return "unknown";
  }
  if (wd < 0) return "unknown";
  for (const p of periods) {
    if (p.day !== wd) continue;
    const o = parseInt(p.open, 10);
    const c = parseInt(p.close, 10);
    const within = c > o ? cur >= o && cur < c : cur >= o || cur < c; // c<=o => overnight
    if (within) return "open";
  }
  return "closed";
}

// ---- Manual hours parsing -------------------------------------------------

const DAY_IDX: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
const dayNum = (s: string): number | null => {
  const k = s.slice(0, 3).toLowerCase();
  return k in DAY_IDX ? DAY_IDX[k] : null;
};

function toHHMM(h: string, m: string | undefined, ap: string | undefined): string {
  let hour = parseInt(h, 10);
  const min = m ? parseInt(m, 10) : 0;
  if (ap) {
    const a = ap.toLowerCase();
    if (a === "pm" && hour < 12) hour += 12;
    if (a === "am" && hour === 12) hour = 0;
  }
  return `${String(hour).padStart(2, "0")}${String(min).padStart(2, "0")}`;
}

/**
 * Best-effort parse of free-text hours into weekly periods. Handles things like
 * "9-5", "9am-5pm", "M-F 8:30-6", "Mon-Fri 9-5", "Sat 10-2". Defaults to
 * Mon–Fri when no day is given. Returns null if it can't find a time range
 * (the raw text is still stored for display).
 */
export function parseHoursText(text: string): DayPeriod[] | null {
  if (!text.trim()) return null;
  const t = text.toLowerCase();

  const tm = t.match(
    /(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:-|to|–|—|until|till)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/,
  );
  if (!tm) return null;
  const open = toHHMM(tm[1], tm[2], tm[3]);
  let close = toHHMM(tm[4], tm[5], tm[6]);
  // No am/pm and close looks earlier than open (e.g. "9-5") → assume close is PM.
  if (!tm[3] && !tm[6]) {
    const oh = parseInt(open.slice(0, 2), 10);
    const ch = parseInt(close.slice(0, 2), 10);
    if (ch <= oh && ch < 12) close = `${String(ch + 12).padStart(2, "0")}${close.slice(2)}`;
  }

  let startDay = 1;
  let endDay = 5; // default Mon–Fri
  const range = t.match(
    /\b(sun|mon|tue|wed|thu|fri|sat)[a-z]*\s*(?:-|to|–|—|through|thru)\s*(sun|mon|tue|wed|thu|fri|sat)[a-z]*/,
  );
  if (range) {
    const a = dayNum(range[1]);
    const b = dayNum(range[2]);
    if (a != null && b != null) {
      startDay = a;
      endDay = b;
    }
  } else {
    const single = t.match(/\b(sun|mon|tue|wed|thu|fri|sat)[a-z]*\b/);
    if (single) {
      const d = dayNum(single[1]);
      if (d != null) {
        startDay = d;
        endDay = d;
      }
    }
  }

  const periods: DayPeriod[] = [];
  let d = startDay;
  for (let i = 0; i < 7; i++) {
    periods.push({ day: d, open, close });
    if (d === endDay) break;
    d = (d + 1) % 7;
  }
  return periods.length ? periods : null;
}
