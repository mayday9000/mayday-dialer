import Link from "next/link";
import { and, eq, gte, isNotNull, asc, lte, or } from "drizzle-orm";
import { db } from "@/lib/db";
import { leads, bookings } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth-server";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatPhone } from "@/lib/phone";
import { getDialerStats, getScraperStats, getMomentum, getLeaderboard } from "@/lib/stats";
import {
  StatTile,
  TrendBadge,
  ActivityChart,
  MeterRow,
  fmtDuration,
  pct,
} from "@/components/today-stats";
import { Leaderboard } from "@/components/leaderboard";
import {
  Phone,
  CalendarClock,
  PhoneCall,
  PhoneOutgoing,
  MessageSquare,
  Voicemail,
  CalendarCheck,
  Timer,
  Sparkles,
  Database,
  ClipboardCheck,
  TrendingUp,
  Flame,
  Trophy,
  Gauge,
} from "lucide-react";
import { format, isPast, isToday } from "date-fns";

export default async function TodayPage() {
  const user = await requireUser();
  const now = new Date();
  const horizon = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  const [dueCallbacks, upcoming, stats, scraper, momentum, lb7, lb30, lbAll] = await Promise.all([
    db
      .select()
      .from(leads)
      .where(and(isNotNull(leads.callbackAt), lte(leads.callbackAt, horizon)))
      .orderBy(asc(leads.callbackAt))
      .limit(25),
    db
      .select()
      .from(bookings)
      .where(
        and(
          eq(bookings.userId, user.id),
          eq(bookings.status, "scheduled"),
          or(gte(bookings.startAt, now), isNotNull(bookings.startAt)),
        ),
      )
      .orderBy(asc(bookings.startAt))
      .limit(25),
    getDialerStats(user.id, now),
    getScraperStats(now),
    getMomentum(user.id, now),
    getLeaderboard(now, 7),
    getLeaderboard(now, 30),
    getLeaderboard(now, null),
  ]);

  const upcomingFuture = upcoming.filter((b) => b.startAt >= now);
  const t = stats.today;
  const cov = scraper.coverage;

  return (
    <div className="flex flex-col">
      <PageHeader title="Overview" description={`Welcome back, ${user.name.split(" ")[0]}.`}>
        <Button asChild>
          <Link href="/dial">
            <PhoneCall className="size-4" />
            Start dialing
          </Link>
        </Button>
      </PageHeader>

      <div className="space-y-8 p-6">
        {/* --- Today at a glance --- */}
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-muted-foreground">Today at a glance</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <StatTile
              label="Dials"
              value={t.dials}
              icon={PhoneOutgoing}
              delta={{ now: t.dials, prev: stats.yesterday.dials }}
              hint={
                stats.busiestHour
                  ? `Busiest ${formatHour(stats.busiestHour.hour)} · ${stats.busiestHour.dials}`
                  : "vs yesterday"
              }
            />
            <StatTile
              label="Pickups"
              value={t.pickups}
              icon={Phone}
              tone="good"
              hint={`${pct(t.pickups, t.dials)} answer rate`}
            />
            <StatTile
              label="Conversations"
              value={t.conversations}
              icon={MessageSquare}
              tone="good"
              hint={`${pct(t.conversations, t.dials)} of dials`}
            />
            <StatTile
              label="Voicemails"
              value={countOutcome(stats.todayOutcomes, "voicemail")}
              icon={Voicemail}
              tone="neutral"
              hint={`${countOutcome(stats.todayOutcomes, "no_answer")} no-answer`}
            />
            <StatTile
              label="Booked"
              value={t.booked}
              icon={CalendarCheck}
              tone="good"
              delta={{ now: t.booked, prev: stats.yesterday.booked }}
              hint={`${pct(t.booked, t.dials)} of dials`}
            />
            <StatTile
              label="Talk time"
              value={fmtDuration(t.talkSec)}
              icon={Timer}
              hint={
                t.conversations
                  ? `${fmtDuration(Math.round(t.talkSec / t.conversations))} avg`
                  : "no conversations yet"
              }
            />
          </div>
        </section>

        {/* --- Your momentum (gamified records) + leaderboard --- */}
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-muted-foreground">Your momentum</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <StatTile
              label="Day streak"
              value={momentum.currentStreak}
              icon={Flame}
              tone={momentum.currentStreak > 0 ? "good" : "default"}
              hint={
                momentum.longestStreak > 0
                  ? `best ${momentum.longestStreak} day${momentum.longestStreak === 1 ? "" : "s"}`
                  : "call today to start"
              }
            />
            <StatTile
              label="Best day"
              value={momentum.bestDay?.dials ?? 0}
              icon={Trophy}
              hint={momentum.bestDay ? `${momentum.bestDay.label} · dials` : "no calls yet"}
            />
            <StatTile
              label="Avg / day"
              value={momentum.avgPerActiveDay}
              icon={Gauge}
              hint={`over ${momentum.activeDays} active day${momentum.activeDays === 1 ? "" : "s"}`}
            />
            <StatTile
              label="Total dials"
              value={stats.allTime.dials.toLocaleString()}
              icon={PhoneOutgoing}
              hint="all-time"
            />
            <StatTile
              label="Conversations"
              value={stats.allTime.conversations.toLocaleString()}
              icon={MessageSquare}
              tone="good"
              hint={`${pct(stats.allTime.conversations, stats.allTime.dials)} of dials`}
            />
            <StatTile
              label="Booked"
              value={stats.allTime.booked.toLocaleString()}
              icon={CalendarCheck}
              tone="good"
              hint="all-time"
            />
          </div>
          <Leaderboard
            currentUserId={user.id}
            ranges={[
              { key: "7d", label: "7 days", rows: lb7 },
              { key: "30d", label: "30 days", rows: lb30 },
              { key: "all", label: "All time", rows: lbAll },
            ]}
          />
        </section>

        {/* --- 7-day activity + conversion funnel --- */}
        <section className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <CardTitle className="flex items-center gap-2 text-base">
                <TrendingUp className="size-4 text-muted-foreground" />
                Last 7 days
              </CardTitle>
              <div className="flex items-center gap-2 text-sm">
                <span className="font-medium tabular-nums">{stats.last7.dials} dials</span>
                <TrendBadge now={stats.last7.dials} prev={stats.prior7.dials} />
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <ActivityChart days={stats.days} />
              <div className="flex justify-between border-t pt-3 text-center text-xs text-muted-foreground">
                <div>
                  <div className="text-base font-semibold text-foreground tabular-nums">
                    {stats.last7.conversations}
                  </div>
                  conversations
                </div>
                <div>
                  <div className="text-base font-semibold text-foreground tabular-nums">
                    {stats.last7.booked}
                  </div>
                  booked
                </div>
                <div>
                  <div className="text-base font-semibold text-foreground tabular-nums">
                    {fmtDuration(stats.last7.talkSec)}
                  </div>
                  talk time
                </div>
                <div>
                  <div className="text-base font-semibold text-foreground tabular-nums">
                    {pct(stats.last7.conversations, stats.last7.dials)}
                  </div>
                  convo rate
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Sparkles className="size-4 text-muted-foreground" />
                Today&apos;s funnel
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <MeterRow label="Dials" value={t.dials} base={t.dials} suffix="placed" />
              <MeterRow
                label="Pickups"
                value={t.pickups}
                base={t.dials}
                suffix={pct(t.pickups, t.dials)}
                tone="emerald"
              />
              <MeterRow
                label="Conversations"
                value={t.conversations}
                base={t.dials}
                suffix={pct(t.conversations, t.dials)}
                tone="emerald"
              />
              <MeterRow
                label="Booked"
                value={t.booked}
                base={t.dials}
                suffix={pct(t.booked, t.dials)}
                tone="amber"
              />
              <p className="pt-1 text-xs text-muted-foreground">
                {t.booked > 0 && t.conversations > 0
                  ? `${pct(t.booked, t.conversations)} of conversations turned into a booking.`
                  : "Book a meeting to start the conversion line."}
              </p>
            </CardContent>
          </Card>
        </section>

        {/* --- Due callbacks + Upcoming bookings (existing) --- */}
        <section className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <CardTitle className="flex items-center gap-2 text-base">
                <Phone className="size-4 text-muted-foreground" />
                Due callbacks
              </CardTitle>
              <Badge variant="secondary">{dueCallbacks.length}</Badge>
            </CardHeader>
            <CardContent className="space-y-2">
              {dueCallbacks.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  No callbacks scheduled. Set one on a lead while you call.
                </p>
              ) : (
                dueCallbacks.map((lead) => {
                  const due = lead.callbackAt!;
                  const overdue = isPast(due) && !isToday(due);
                  return (
                    <Link
                      key={lead.id}
                      href={`/leads/${lead.id}`}
                      className="flex items-center justify-between rounded-md border px-3 py-2 text-sm hover:bg-accent"
                    >
                      <div className="min-w-0">
                        <div className="truncate font-medium">
                          {lead.companyName || lead.contactName || formatPhone(lead.phone)}
                        </div>
                        <div className="truncate text-xs text-muted-foreground">
                          {lead.contactName ? `${lead.contactName} · ` : ""}
                          {formatPhone(lead.phone)}
                        </div>
                      </div>
                      <Badge variant={overdue ? "destructive" : "outline"}>
                        {isToday(due) ? format(due, "p") : format(due, "MMM d, p")}
                      </Badge>
                    </Link>
                  );
                })
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <CardTitle className="flex items-center gap-2 text-base">
                <CalendarClock className="size-4 text-muted-foreground" />
                Upcoming bookings
              </CardTitle>
              <Badge variant="secondary">{upcomingFuture.length}</Badge>
            </CardHeader>
            <CardContent className="space-y-2">
              {upcomingFuture.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  No upcoming meetings. Book one during a call.
                </p>
              ) : (
                upcomingFuture.map((b) => (
                  <Link
                    key={b.id}
                    href={`/leads/${b.leadId}`}
                    className="flex items-center justify-between rounded-md border px-3 py-2 text-sm hover:bg-accent"
                  >
                    <div className="min-w-0">
                      <div className="truncate font-medium">{b.title}</div>
                      {b.notes && (
                        <div className="truncate text-xs text-muted-foreground">{b.notes}</div>
                      )}
                    </div>
                    <Badge variant="outline">{format(b.startAt, "MMM d, p")}</Badge>
                  </Link>
                ))
              )}
            </CardContent>
          </Card>
        </section>

        {/* --- Pipeline health --- */}
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-muted-foreground">Pipeline</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Link href="/dial" className="contents">
              <StatTile
                label="Dialable now"
                value={stats.pipeline.dialable}
                icon={PhoneOutgoing}
                tone={stats.pipeline.dialable < 25 ? "neutral" : "good"}
                hint={stats.pipeline.dialable < 25 ? "running low" : "in the queue"}
              />
            </Link>
            <StatTile
              label="Never called"
              value={stats.pipeline.neverCalled}
              icon={Sparkles}
              hint="fresh leads"
            />
            <StatTile
              label="Callbacks due"
              value={stats.pipeline.callbacksDueToday}
              icon={Phone}
              tone={stats.pipeline.callbacksDueToday > 0 ? "neutral" : "default"}
              hint="today or overdue"
            />
            <StatTile
              label="Booked all-time"
              value={stats.allTime.booked}
              icon={CalendarCheck}
              tone="good"
              hint={`${stats.allTime.dials.toLocaleString()} dials total`}
            />
          </div>
          {stats.pipeline.byStatus.length > 0 && (
            <div className="flex flex-wrap gap-2 pt-1">
              {stats.pipeline.byStatus
                .slice()
                .sort((a, b) => b.count - a.count)
                .map((s) => (
                  <Badge key={s.status} variant="outline" className="gap-1">
                    <span className="capitalize">{s.status.replace(/_/g, " ")}</span>
                    <span className="tabular-nums text-muted-foreground">{s.count}</span>
                  </Badge>
                ))}
            </div>
          )}
        </section>

        {/* --- Lead scraper --- */}
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-muted-foreground">Lead scraper</h2>
            <Button asChild variant="ghost" size="sm">
              <Link href="/admin/lead-sources">Manage sources</Link>
            </Button>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatTile
              label="Harvested"
              value={scraper.harvested.total}
              icon={Database}
              hint={`${scraper.harvested.approved} approved`}
            />
            <Link href="/admin/lead-sources/review" className="contents">
              <StatTile
                label="Pending review"
                value={scraper.harvested.pending}
                icon={ClipboardCheck}
                tone={scraper.harvested.pending > 0 ? "neutral" : "default"}
                hint={scraper.harvested.pending > 0 ? "tap to review" : "all caught up"}
              />
            </Link>
            <StatTile
              label="Added (7d)"
              value={scraper.addedLast7}
              icon={Sparkles}
              hint={`${scraper.activeSearches} active search${scraper.activeSearches === 1 ? "" : "es"}`}
            />
            <StatTile
              label="Dedup rate"
              value={scraper.dedupRate === null ? "—" : `${Math.round(scraper.dedupRate * 100)}%`}
              icon={Database}
              hint={`${scraper.lifetime.found.toLocaleString()} seen all-time`}
            />
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Data coverage</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <MeterRow label="Decision-maker name" value={cov.withContact} base={cov.total} suffix={pct(cov.withContact, cov.total)} tone="emerald" />
                <MeterRow label="Email" value={cov.withEmail} base={cov.total} suffix={pct(cov.withEmail, cov.total)} />
                <MeterRow label="Office hours (open-now)" value={cov.withHours} base={cov.total} suffix={pct(cov.withHours, cov.total)} />
                <MeterRow label="Verified hours" value={cov.verifiedHours} base={cov.total} suffix={pct(cov.verifiedHours, cov.total)} tone="amber" />
                <p className="pt-1 text-xs text-muted-foreground">
                  Across {cov.total.toLocaleString()} active leads.
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Last harvest run</CardTitle>
              </CardHeader>
              <CardContent>
                {scraper.lastRun ? (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium">{scraper.lastRun.searchLabel || "—"}</span>
                      <span className="text-xs text-muted-foreground">
                        {scraper.lastRun.at ? format(scraper.lastRun.at, "MMM d, p") : "in progress"}
                        {scraper.lastRun.trigger ? ` · ${scraper.lastRun.trigger}` : ""}
                      </span>
                    </div>
                    <div className="grid grid-cols-4 gap-2 text-center">
                      {[
                        { k: "Found", v: scraper.lastRun.found },
                        { k: "New", v: scraper.lastRun.newCount },
                        { k: "Dupes", v: scraper.lastRun.dupes },
                        { k: "Rejected", v: scraper.lastRun.rejected },
                      ].map((c) => (
                        <div key={c.k} className="rounded-md border py-2">
                          <div className="text-lg font-semibold tabular-nums">{c.v}</div>
                          <div className="text-[11px] text-muted-foreground">{c.k}</div>
                        </div>
                      ))}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {scraper.lifetime.runs} run{scraper.lifetime.runs === 1 ? "" : "s"} all-time ·{" "}
                      {scraper.lifetime.newCount.toLocaleString()} leads added.
                    </p>
                  </div>
                ) : (
                  <p className="py-6 text-center text-sm text-muted-foreground">
                    No harvest runs yet.{" "}
                    <Link href="/admin/lead-sources" className="underline">
                      Set up a source
                    </Link>
                    .
                  </p>
                )}
              </CardContent>
            </Card>
          </div>
        </section>
      </div>
    </div>
  );
}

function countOutcome(slices: { outcome: string; count: number }[], outcome: string): number {
  return slices.find((s) => s.outcome === outcome)?.count ?? 0;
}

function formatHour(hour: number): string {
  const h = ((hour + 11) % 12) + 1;
  const ampm = hour < 12 ? "am" : "pm";
  return `${h}${ampm}`;
}
