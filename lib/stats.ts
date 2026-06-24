/**
 * Dashboard aggregates for the Today page. All call/booking time math is pinned
 * to the user's home timezone (ET) so "today" means today *here*, not UTC on
 * Vercel. Heavy lifting stays in Postgres (FILTER + date_trunc), so these are a
 * handful of cheap grouped scans, not row pulls.
 */
import { and, eq, gte, lte, sql, inArray, isNull, isNotNull, like, or } from "drizzle-orm";
import { db } from "@/lib/db";
import { callLogs, leads, harvestRuns, harvestSearches } from "@/lib/db/schema";
import { user } from "@/lib/db/auth-schema";
import { DIALABLE_STATUSES } from "@/lib/dial";

// The operator works the East Coast. One place to change if that ever moves.
export const STATS_TZ = "America/New_York";

// --- timezone-aware day boundaries -----------------------------------

function tzOffsetMs(date: Date, tz: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const m: Record<string, number> = {};
  for (const p of dtf.formatToParts(date)) {
    if (p.type !== "literal") m[p.type] = parseInt(p.value, 10);
  }
  const asUTC = Date.UTC(m.year, m.month - 1, m.day, m.hour, m.minute, m.second);
  return asUTC - date.getTime();
}

/** UTC instant of midnight (start of day) in `tz`, `daysAgo` days before now. */
export function startOfDayInTz(now: Date, tz: string, daysAgo = 0): Date {
  const offset = tzOffsetMs(now, tz);
  const wall = new Date(now.getTime() + offset);
  const midnightWallUTC = Date.UTC(
    wall.getUTCFullYear(),
    wall.getUTCMonth(),
    wall.getUTCDate() - daysAgo,
  );
  // Re-evaluate the offset at that midnight so DST transitions don't drift.
  const offset2 = tzOffsetMs(new Date(midnightWallUTC - offset), tz);
  return new Date(midnightWallUTC - offset2);
}

/** "YYYY-MM-DD" for `date` as seen in `tz`. */
export function dayKeyInTz(date: Date, tz: string): string {
  const dtf = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return dtf.format(date); // en-CA gives YYYY-MM-DD
}

// --- types -----------------------------------------------------------

export type DayBucket = {
  key: string; // YYYY-MM-DD (ET)
  label: string; // "Mon"
  dials: number;
  pickups: number;
  conversations: number;
  booked: number;
  talkSec: number;
};

export type OutcomeSlice = { outcome: string; count: number };

export type DialerStats = {
  today: DayBucket;
  yesterday: DayBucket;
  days: DayBucket[]; // last 7 ET days, oldest -> newest, gaps filled with zeros
  last7: { dials: number; pickups: number; conversations: number; booked: number; talkSec: number };
  prior7: { dials: number; pickups: number; conversations: number; booked: number; talkSec: number };
  allTime: { dials: number; conversations: number; booked: number; talkSec: number };
  todayOutcomes: OutcomeSlice[];
  busiestHour: { hour: number; dials: number } | null; // today, ET
  pipeline: {
    dialable: number;
    neverCalled: number; // dialable leads with zero call logs
    callbacksDueToday: number;
    byStatus: { status: string; count: number }[];
  };
};

export type ScraperStats = {
  harvested: { total: number; approved: number; pending: number; rejected: number };
  addedLast7: number;
  activeSearches: number;
  totalSearches: number;
  lifetime: { found: number; newCount: number; dupes: number; rejected: number; runs: number };
  dedupRate: number | null; // dupes / found
  lastRun: {
    at: Date | null;
    trigger: string | null;
    found: number;
    newCount: number;
    dupes: number;
    rejected: number;
    searchLabel: string | null;
  } | null;
  coverage: {
    total: number;
    withContact: number;
    withEmail: number;
    withHours: number;
    verifiedHours: number;
  };
};

// A pickup = a human (or machine that isn't ring-out) answered.
const PICKUP_SQL = sql`${callLogs.outcome} not in ('no_answer','busy','voicemail')`;
const CONVO_SQL = sql`${callLogs.outcome} in ('connected','booked','callback','not_interested')`;

function emptyBucket(key: string, label: string): DayBucket {
  return { key, label, dials: 0, pickups: 0, conversations: 0, booked: 0, talkSec: 0 };
}

// --- dialer stats ----------------------------------------------------

export async function getDialerStats(userId: string, now = new Date()): Promise<DialerStats> {
  const since14 = startOfDayInTz(now, STATS_TZ, 13);
  const since1 = startOfDayInTz(now, STATS_TZ, 1); // start of yesterday
  const startToday = startOfDayInTz(now, STATS_TZ, 0);

  // Timezone must be a SQL literal: a bound param inside `AT TIME ZONE $n`
  // can't be type-inferred by Postgres ("could not determine data type").
  // STATS_TZ is a trusted constant, so sql.raw is safe here.
  const tz = sql.raw(`'${STATS_TZ}'`);
  const dayExpr = sql<string>`to_char(date_trunc('day', ${callLogs.startedAt} at time zone ${tz}), 'YYYY-MM-DD')`;

  const [daily, allTimeRows, outcomeRows, hourRows, pipelineRows, statusRows, callbackRows] =
    await Promise.all([
      // 14 days of ET-bucketed call activity (covers last-7 vs prior-7).
      db
        .select({
          key: dayExpr,
          dials: sql<number>`count(*)::int`,
          pickups: sql<number>`(count(*) filter (where ${PICKUP_SQL}))::int`,
          conversations: sql<number>`(count(*) filter (where ${CONVO_SQL}))::int`,
          booked: sql<number>`(count(*) filter (where ${callLogs.outcome} = 'booked'))::int`,
          talkSec: sql<number>`coalesce(sum(${callLogs.durationSec}), 0)::int`,
        })
        .from(callLogs)
        .where(and(eq(callLogs.userId, userId), gte(callLogs.startedAt, since14)))
        .groupBy(dayExpr),
      db
        .select({
          dials: sql<number>`count(*)::int`,
          conversations: sql<number>`(count(*) filter (where ${CONVO_SQL}))::int`,
          booked: sql<number>`(count(*) filter (where ${callLogs.outcome} = 'booked'))::int`,
          talkSec: sql<number>`coalesce(sum(${callLogs.durationSec}), 0)::int`,
        })
        .from(callLogs)
        .where(eq(callLogs.userId, userId)),
      db
        .select({
          outcome: sql<string>`coalesce(${callLogs.outcome}, 'unknown')`,
          count: sql<number>`count(*)::int`,
        })
        .from(callLogs)
        .where(and(eq(callLogs.userId, userId), gte(callLogs.startedAt, startToday)))
        .groupBy(callLogs.outcome),
      // Busiest ET hour today.
      db
        .select({
          hour: sql<number>`extract(hour from ${callLogs.startedAt} at time zone ${tz})::int`,
          dials: sql<number>`count(*)::int`,
        })
        .from(callLogs)
        .where(and(eq(callLogs.userId, userId), gte(callLogs.startedAt, startToday)))
        .groupBy(sql`1`)
        .orderBy(sql`2 desc`)
        .limit(1),
      // Dialable + never-called (no call log) leads.
      db
        .select({
          dialable: sql<number>`count(*)::int`,
          neverCalled: sql<number>`(count(*) filter (where not exists (select 1 from ${callLogs} cl where cl.lead_id = ${leads.id})))::int`,
        })
        .from(leads)
        .where(
          and(
            eq(leads.archived, false),
            inArray(leads.status, DIALABLE_STATUSES),
            or(isNull(leads.reviewState), eq(leads.reviewState, "approved")),
          ),
        ),
      // Status breakdown (non-archived, not gated as pending/rejected).
      db
        .select({ status: leads.status, count: sql<number>`count(*)::int` })
        .from(leads)
        .where(
          and(
            eq(leads.archived, false),
            or(isNull(leads.reviewState), eq(leads.reviewState, "approved")),
          ),
        )
        .groupBy(leads.status),
      // Callbacks due by end of today.
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(leads)
        .where(
          and(
            isNotNull(leads.callbackAt),
            lte(leads.callbackAt, startOfDayInTz(now, STATS_TZ, -1)),
            eq(leads.archived, false),
          ),
        ),
    ]);

  // Index daily rows by ET day key.
  const byKey = new Map(daily.map((d) => [d.key, d]));
  const labelFmt = new Intl.DateTimeFormat("en-US", { timeZone: STATS_TZ, weekday: "short" });

  const days: DayBucket[] = [];
  for (let i = 6; i >= 0; i--) {
    const dayStart = startOfDayInTz(now, STATS_TZ, i);
    const key = dayKeyInTz(dayStart, STATS_TZ);
    const label = labelFmt.format(dayStart);
    const row = byKey.get(key);
    days.push(
      row
        ? { key, label, dials: row.dials, pickups: row.pickups, conversations: row.conversations, booked: row.booked, talkSec: row.talkSec }
        : emptyBucket(key, label),
    );
  }

  const todayKey = dayKeyInTz(startToday, STATS_TZ);
  const yesterdayKey = dayKeyInTz(since1, STATS_TZ);
  const todayRow = byKey.get(todayKey);
  const yesterdayRow = byKey.get(yesterdayKey);
  const today = todayRow
    ? { key: todayKey, label: "Today", dials: todayRow.dials, pickups: todayRow.pickups, conversations: todayRow.conversations, booked: todayRow.booked, talkSec: todayRow.talkSec }
    : emptyBucket(todayKey, "Today");
  const yesterday = yesterdayRow
    ? { key: yesterdayKey, label: "Yesterday", dials: yesterdayRow.dials, pickups: yesterdayRow.pickups, conversations: yesterdayRow.conversations, booked: yesterdayRow.booked, talkSec: yesterdayRow.talkSec }
    : emptyBucket(yesterdayKey, "Yesterday");

  const sumRange = (fromDaysAgo: number, toDaysAgo: number) => {
    const acc = { dials: 0, pickups: 0, conversations: 0, booked: 0, talkSec: 0 };
    for (const row of daily) {
      // Compare keys against the window edges.
      const start = dayKeyInTz(startOfDayInTz(now, STATS_TZ, fromDaysAgo), STATS_TZ);
      const end = dayKeyInTz(startOfDayInTz(now, STATS_TZ, toDaysAgo), STATS_TZ);
      if (row.key >= start && row.key <= end) {
        acc.dials += row.dials;
        acc.pickups += row.pickups;
        acc.conversations += row.conversations;
        acc.booked += row.booked;
        acc.talkSec += row.talkSec;
      }
    }
    return acc;
  };

  const last7 = sumRange(6, 0);
  const prior7 = sumRange(13, 7);
  const at = allTimeRows[0] ?? { dials: 0, conversations: 0, booked: 0, talkSec: 0 };

  return {
    today,
    yesterday,
    days,
    last7,
    prior7,
    allTime: { dials: at.dials, conversations: at.conversations, booked: at.booked, talkSec: at.talkSec },
    todayOutcomes: outcomeRows
      .map((o) => ({ outcome: o.outcome, count: o.count }))
      .sort((a, b) => b.count - a.count),
    busiestHour: hourRows[0] ? { hour: hourRows[0].hour, dials: hourRows[0].dials } : null,
    pipeline: {
      dialable: pipelineRows[0]?.dialable ?? 0,
      neverCalled: pipelineRows[0]?.neverCalled ?? 0,
      callbacksDueToday: callbackRows[0]?.count ?? 0,
      byStatus: statusRows.map((s) => ({ status: s.status, count: s.count })),
    },
  };
}

// --- scraper stats ---------------------------------------------------

export async function getScraperStats(now = new Date()): Promise<ScraperStats> {
  const since7 = startOfDayInTz(now, STATS_TZ, 6);

  const [harvestRow, addedRow, runAgg, lastRunRows, searchRows, coverageRow] = await Promise.all([
    db
      .select({
        total: sql<number>`count(*)::int`,
        approved: sql<number>`(count(*) filter (where ${leads.reviewState} = 'approved'))::int`,
        pending: sql<number>`(count(*) filter (where ${leads.reviewState} = 'pending'))::int`,
        rejected: sql<number>`(count(*) filter (where ${leads.reviewState} = 'rejected'))::int`,
      })
      .from(leads)
      .where(like(leads.source, "harvest:%")),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(leads)
      .where(and(like(leads.source, "harvest:%"), gte(leads.createdAt, since7))),
    db
      .select({
        found: sql<number>`coalesce(sum(${harvestRuns.found}), 0)::int`,
        newCount: sql<number>`coalesce(sum(${harvestRuns.newCount}), 0)::int`,
        dupes: sql<number>`coalesce(sum(${harvestRuns.dupes}), 0)::int`,
        rejected: sql<number>`coalesce(sum(${harvestRuns.rejected}), 0)::int`,
        runs: sql<number>`count(*)::int`,
      })
      .from(harvestRuns),
    db
      .select({
        at: harvestRuns.finishedAt,
        startedAt: harvestRuns.startedAt,
        trigger: harvestRuns.trigger,
        found: harvestRuns.found,
        newCount: harvestRuns.newCount,
        dupes: harvestRuns.dupes,
        rejected: harvestRuns.rejected,
        searchLabel: harvestSearches.label,
      })
      .from(harvestRuns)
      .leftJoin(harvestSearches, eq(harvestSearches.id, harvestRuns.searchId))
      .orderBy(sql`${harvestRuns.startedAt} desc`)
      .limit(1),
    db
      .select({
        total: sql<number>`count(*)::int`,
        active: sql<number>`(count(*) filter (where ${harvestSearches.active}))::int`,
      })
      .from(harvestSearches),
    db
      .select({
        total: sql<number>`count(*)::int`,
        withContact: sql<number>`(count(*) filter (where ${leads.contactName} is not null and ${leads.contactName} <> ''))::int`,
        withEmail: sql<number>`(count(*) filter (where ${leads.email} is not null and ${leads.email} <> ''))::int`,
        withHours: sql<number>`(count(*) filter (where (${leads.enrichment} -> 'officeHours' -> 'periods') is not null))::int`,
        verifiedHours: sql<number>`(count(*) filter (where (${leads.enrichment} -> 'officeHours' ->> 'verified') = 'true'))::int`,
      })
      .from(leads)
      .where(eq(leads.archived, false)),
  ]);

  const h = harvestRow[0] ?? { total: 0, approved: 0, pending: 0, rejected: 0 };
  const agg = runAgg[0] ?? { found: 0, newCount: 0, dupes: 0, rejected: 0, runs: 0 };
  const lr = lastRunRows[0] ?? null;
  const cov = coverageRow[0] ?? { total: 0, withContact: 0, withEmail: 0, withHours: 0, verifiedHours: 0 };

  return {
    harvested: { total: h.total, approved: h.approved, pending: h.pending, rejected: h.rejected },
    addedLast7: addedRow[0]?.count ?? 0,
    activeSearches: searchRows[0]?.active ?? 0,
    totalSearches: searchRows[0]?.total ?? 0,
    lifetime: { found: agg.found, newCount: agg.newCount, dupes: agg.dupes, rejected: agg.rejected, runs: agg.runs },
    dedupRate: agg.found > 0 ? agg.dupes / agg.found : null,
    lastRun: lr
      ? {
          at: lr.at ?? lr.startedAt ?? null,
          trigger: lr.trigger,
          found: lr.found,
          newCount: lr.newCount,
          dupes: lr.dupes,
          rejected: lr.rejected,
          searchLabel: lr.searchLabel,
        }
      : null,
    coverage: {
      total: cov.total,
      withContact: cov.withContact,
      withEmail: cov.withEmail,
      withHours: cov.withHours,
      verifiedHours: cov.verifiedHours,
    },
  };
}

// --- momentum (gamified personal records) ----------------------------

export type Momentum = {
  activeDays: number; // distinct ET days with at least one dial
  avgPerActiveDay: number; // dials / active day
  bestDay: { key: string; label: string; dials: number } | null;
  currentStreak: number; // consecutive ET days with a dial, up to today
  longestStreak: number;
};

/** A YYYY-MM-DD ET day key → an integer day number, so consecutive calendar
 *  days differ by exactly 1 (the absolute offset is irrelevant). */
function dayNumber(key: string): number {
  return Math.round(Date.parse(`${key}T00:00:00Z`) / 86_400_000);
}

export async function getMomentum(userId: string, now = new Date()): Promise<Momentum> {
  const tz = sql.raw(`'${STATS_TZ}'`);
  const dayExpr = sql<string>`to_char(date_trunc('day', ${callLogs.startedAt} at time zone ${tz}), 'YYYY-MM-DD')`;

  const rows = await db
    .select({ key: dayExpr, dials: sql<number>`count(*)::int` })
    .from(callLogs)
    .where(eq(callLogs.userId, userId))
    .groupBy(dayExpr);

  if (rows.length === 0) {
    return { activeDays: 0, avgPerActiveDay: 0, bestDay: null, currentStreak: 0, longestStreak: 0 };
  }

  const total = rows.reduce((s, r) => s + r.dials, 0);
  const best = rows.reduce((a, b) => (b.dials > a.dials ? b : a));
  const bestLabel = new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
  }).format(new Date(`${best.key}T12:00:00Z`));

  const days = new Set(rows.map((r) => dayNumber(r.key)));
  const todayNum = dayNumber(dayKeyInTz(now, STATS_TZ));

  // Current streak: count back from today (an empty today doesn't break it — the
  // day isn't over yet, so start from yesterday in that case).
  let currentStreak = 0;
  let cursor = days.has(todayNum) ? todayNum : todayNum - 1;
  while (days.has(cursor)) {
    currentStreak++;
    cursor--;
  }

  // Longest run of consecutive active days, ever.
  const sorted = [...days].sort((a, b) => a - b);
  let longest = 1;
  let run = 1;
  for (let i = 1; i < sorted.length; i++) {
    run = sorted[i] === sorted[i - 1] + 1 ? run + 1 : 1;
    if (run > longest) longest = run;
  }

  return {
    activeDays: rows.length,
    avgPerActiveDay: Math.round(total / rows.length),
    bestDay: { key: best.key, label: bestLabel, dials: best.dials },
    currentStreak,
    longestStreak: Math.max(longest, currentStreak),
  };
}

// --- leaderboard (team) ----------------------------------------------

export type LeaderRow = {
  userId: string;
  name: string;
  dials: number;
  conversations: number;
  booked: number;
  talkSec: number;
};

/**
 * Per-rep totals over a trailing window (`days`), or all-time when `days` is
 * null. Left joins from `user` so every rep appears; the page filters to those
 * with activity. Sorted best-first: booked → conversations → dials.
 */
export async function getLeaderboard(now: Date, days: number | null): Promise<LeaderRow[]> {
  const since = days == null ? null : startOfDayInTz(now, STATS_TZ, days - 1);
  const joinCond = since
    ? and(eq(callLogs.userId, user.id), gte(callLogs.startedAt, since))
    : eq(callLogs.userId, user.id);

  const rows = await db
    .select({
      userId: user.id,
      name: user.name,
      dials: sql<number>`count(${callLogs.id})::int`,
      conversations: sql<number>`(count(*) filter (where ${CONVO_SQL}))::int`,
      booked: sql<number>`(count(*) filter (where ${callLogs.outcome} = 'booked'))::int`,
      talkSec: sql<number>`coalesce(sum(${callLogs.durationSec}), 0)::int`,
    })
    .from(user)
    .leftJoin(callLogs, joinCond)
    .groupBy(user.id, user.name);

  return rows.sort(
    (a, b) => b.booked - a.booked || b.conversations - a.conversations || b.dials - a.dials,
  );
}
