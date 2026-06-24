import Link from "next/link";
import { eq, desc, asc, sql, inArray, and } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  campaigns,
  campaignLeads,
  campaignMarkets,
  campaignNumbers,
  leads,
  callLogs,
  callTranscripts,
  type TranscriptAnalysis,
} from "@/lib/db/schema";
import { user } from "@/lib/db/auth-schema";
import { requireUser } from "@/lib/auth-server";
import { loadRepScript } from "@/lib/rep-script";
import { getGoogleStatus } from "@/lib/google";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatPhone, toE164 } from "@/lib/phone";
import { DialSession, type QueueLead, type DialMarket, type CallAnalysis } from "./dial-session";
import { DIALABLE_STATUSES, CLAIM_TTL_MS, NO_CONTACT_OUTCOMES, restMsFor } from "@/lib/dial";
import { Megaphone, Users, PhoneCall, CheckCircle2 } from "lucide-react";
import type { DialerProviderName } from "@/lib/dialer/types";

type LastCall = { outcome: string | null; note: string | null; at: string };
type CallHistoryItem = {
  at: string;
  outcome: string | null;
  note: string | null;
  durationSec: number | null;
  by: string | null;
  analysis: CallAnalysis | null; // AI call notes for this call (if transcribed)
};

/** Trim the full transcript analysis to the fields the cockpit shows. */
function trimAnalysis(a: TranscriptAnalysis | null): CallAnalysis | null {
  if (!a) return null;
  const summary = a.summary?.trim();
  const bullets = (a.bullets ?? []).filter(Boolean);
  const nextStep = a.nextStep?.trim() || null;
  const objections = (a.objections ?? []).filter(Boolean);
  if (!summary && !bullets.length && !nextStep && !objections.length) return null;
  return { summary, bullets, nextStep, objections };
}

function toQueueLead(
  l: typeof leads.$inferSelect,
  marketId: string | null,
  lastCall: LastCall | null,
  lastVoicemailAt: string | null,
  history: CallHistoryItem[],
): QueueLead {
  return {
    id: l.id,
    companyName: l.companyName,
    contactName: l.contactName,
    title: l.title,
    phoneDisplay: formatPhone(l.phone),
    phoneE164: toE164(l.phone),
    email: l.email,
    website: l.website,
    status: l.status,
    marketId,
    customFields: l.customFields ?? null,
    enrichment: l.enrichment ?? null,
    keyNotes: l.keyNotes ?? null,
    lastCall,
    lastVoicemailAt,
    history,
  };
}

function toBookingDefaults(c: {
  meetingTitleTemplate: string | null;
  meetingDescriptionTemplate: string | null;
  meetingDurationMin: number;
  meetingLocation: string | null;
}) {
  return {
    titleTemplate: c.meetingTitleTemplate,
    descriptionTemplate: c.meetingDescriptionTemplate,
    durationMin: c.meetingDurationMin,
    location: c.meetingLocation,
  };
}

const CALLER_ID = process.env.TWILIO_CALLER_ID || null;

/** Active cities for a campaign + each city's local number, and the campaign's
 *  fallback caller ID (a campaign-level number, else the global env). Drives the
 *  cockpit's city selector and the per-city "From" display. */
async function loadDialMarkets(
  campaignId: string,
): Promise<{ markets: DialMarket[]; fallbackCallerId: string | null }> {
  const [marketRows, numberRows] = await Promise.all([
    db
      .select({ id: campaignMarkets.id, name: campaignMarkets.name })
      .from(campaignMarkets)
      .where(and(eq(campaignMarkets.campaignId, campaignId), eq(campaignMarkets.active, true)))
      .orderBy(desc(campaignMarkets.isDefault), asc(campaignMarkets.name)),
    db
      .select({ marketId: campaignNumbers.marketId, e164: campaignNumbers.e164 })
      .from(campaignNumbers)
      .where(eq(campaignNumbers.campaignId, campaignId))
      .orderBy(desc(campaignNumbers.createdAt)),
  ]);
  const byMarket = new Map<string, string>();
  let campaignLevel: string | null = null;
  for (const n of numberRows) {
    if (n.marketId) {
      if (!byMarket.has(n.marketId)) byMarket.set(n.marketId, n.e164);
    } else if (!campaignLevel) {
      campaignLevel = n.e164;
    }
  }
  const markets = marketRows.map((m) => ({
    id: m.id,
    name: m.name,
    number: byMarket.get(m.id) ?? null,
  }));
  return { markets, fallbackCallerId: campaignLevel ?? CALLER_ID };
}

export default async function DialPage(props: PageProps<"/dial">) {
  const user = await requireUser();
  const sp = await props.searchParams;
  const provider: DialerProviderName =
    process.env.DIALER_PROVIDER === "twilio" ? "twilio" : "stub";
  const googleEmail = (await getGoogleStatus(user.id)).email;

  const campaignId = typeof sp.campaign === "string" ? sp.campaign : undefined;
  const leadId = typeof sp.lead === "string" ? sp.lead : undefined;

  // Single-lead call (from a lead's "Call" button) — always shown (the DNC
  // guardrail still blocks the call button if needed).
  if (leadId) {
    const lead = await db.query.leads.findFirst({ where: eq(leads.id, leadId) });
    if (lead) {
      const { last, lastVoicemail, history } = await latestCalls([lead.id]);
      // Attach the script from the lead's campaign (if it belongs to one), so a
      // single-lead call isn't scriptless.
      const membership = await db
        .select({
          id: campaigns.id,
          name: campaigns.name,
          scriptId: campaigns.scriptId,
          marketId: campaignLeads.marketId,
          meetingTitleTemplate: campaigns.meetingTitleTemplate,
          meetingDescriptionTemplate: campaigns.meetingDescriptionTemplate,
          meetingDurationMin: campaigns.meetingDurationMin,
          meetingLocation: campaigns.meetingLocation,
        })
        .from(campaignLeads)
        .innerJoin(campaigns, eq(campaigns.id, campaignLeads.campaignId))
        .where(eq(campaignLeads.leadId, lead.id))
        .orderBy(asc(campaignLeads.addedAt))
        .limit(1);
      const camp = membership[0] ?? null;
      const rep = camp
        ? await loadRepScript(user.id, camp.id, camp.scriptId)
        : { options: [], selectedScriptId: null, markdown: null };
      const { markets, fallbackCallerId } = camp
        ? await loadDialMarkets(camp.id)
        : { markets: [], fallbackCallerId: CALLER_ID };
      return (
        <DialSession
          provider={provider}
          queue={[toQueueLead(lead, camp?.marketId ?? null, last.get(lead.id) ?? null, lastVoicemail.get(lead.id) ?? null, history.get(lead.id) ?? [])]}
          scriptMarkdown={rep.markdown}
          scriptOptions={rep.options}
          selectedScriptId={rep.selectedScriptId}
          campaignName={camp?.name ?? null}
          campaignId={camp?.id ?? null}
          callerId={fallbackCallerId}
          markets={markets}
          googleEmail={googleEmail}
          bookingDefaults={camp ? toBookingDefaults(camp) : null}
        />
      );
    }
  }

  // Campaign dial session.
  if (campaignId) {
    const campaign = await db.query.campaigns.findFirst({ where: eq(campaigns.id, campaignId) });
    if (campaign) {
      const [members, rep] = await Promise.all([
        db
          .select()
          .from(leads)
          .innerJoin(campaignLeads, eq(campaignLeads.leadId, leads.id))
          .where(eq(campaignLeads.campaignId, campaignId))
          .orderBy(asc(campaignLeads.addedAt), asc(campaignLeads.id)),
        loadRepScript(user.id, campaign.id, campaign.scriptId),
      ]);

      const { last, lastVoicemail, restingIds, nowMs, history } = await latestCalls(
        members.map((m) => m.leads.id),
      );

      // "Dial them anyway" — ?resting=1 bypasses the backoff so the rep can work
      // recently-called leads when the fresh pool is dry (the user doesn't mind
      // the occasional repeat).
      const includeResting = sp.resting === "1";

      // Everything dialable except the rest-window check. Splitting it out lets us
      // tell the rep how many leads are merely resting vs. truly gone.
      const eligible = members
        .map((m) => ({ lead: m.leads, marketId: m.campaign_leads.marketId }))
        .filter(({ lead: l }) => {
          if (l.archived) return false; // discarded
          // Harvested candidates awaiting/failing review are never dialed.
          if (l.reviewState === "pending" || l.reviewState === "rejected") return false;
          if (!DIALABLE_STATUSES.includes(l.status)) return false; // skip booked/DNC/etc.
          // Scheduled callbacks stay out of the queue until they're due — a
          // callback set for next week shouldn't surface today. (No date set →
          // still dialable.)
          if (l.status === "callback" && l.callbackAt && l.callbackAt.getTime() > nowMs) {
            return false;
          }
          // Multi-rep: hide leads another rep is actively on (unexpired lease).
          if (
            l.claimedBy &&
            l.claimedBy !== user.id &&
            l.claimedAt &&
            l.claimedAt.getTime() > nowMs - CLAIM_TTL_MS
          ) {
            return false;
          }
          // Multi-rep: a lead owned by another rep is theirs — unless it's their
          // overdue callback, which the team can cover so it doesn't go cold.
          if (l.ownerId && l.ownerId !== user.id) {
            const overdueCallback =
              l.status === "callback" && l.callbackAt != null && l.callbackAt.getTime() <= nowMs;
            if (!overdueCallback) return false;
          }
          return true;
        });

      const ready = includeResting
        ? eligible
        : eligible.filter(({ lead: l }) => !restingIds.has(l.id));
      const restingCount = eligible.length - ready.length;

      const queue: QueueLead[] = ready.map(({ lead: l, marketId }) =>
        toQueueLead(l, marketId, last.get(l.id) ?? null, lastVoicemail.get(l.id) ?? null, history.get(l.id) ?? []),
      );

      if (queue.length === 0) {
        return (
          <NothingToDial
            campaignId={campaignId}
            name={campaign.name}
            total={members.length}
            resting={restingCount}
          />
        );
      }

      const { markets, fallbackCallerId } = await loadDialMarkets(campaignId);

      return (
        <DialSession
          provider={provider}
          queue={queue}
          scriptMarkdown={rep.markdown}
          scriptOptions={rep.options}
          selectedScriptId={rep.selectedScriptId}
          campaignName={campaign.name}
          campaignId={campaign.id}
          callerId={fallbackCallerId}
          markets={markets}
          googleEmail={googleEmail}
          bookingDefaults={toBookingDefaults(campaign)}
        />
      );
    }
  }

  // No target: let the user pick a campaign to dial.
  const rows = await db
    .select({
      id: campaigns.id,
      name: campaigns.name,
      leadCount: sql<number>`count(${campaignLeads.id})::int`,
    })
    .from(campaigns)
    .leftJoin(campaignLeads, eq(campaignLeads.campaignId, campaigns.id))
    .groupBy(campaigns.id)
    .orderBy(desc(campaigns.createdAt));

  return (
    <div className="flex flex-col">
      <PageHeader title="Dial" description="Pick a campaign to start a calling session." />
      <div className="p-6">
        {rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed py-20 text-center">
            <PhoneCall className="size-8 text-muted-foreground" />
            <div className="text-sm text-muted-foreground">No campaigns yet.</div>
            <Button asChild variant="outline" size="sm">
              <Link href="/campaigns">Create a campaign</Link>
            </Button>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {rows.map((c) => (
              <Card key={c.id}>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Megaphone className="size-4 text-muted-foreground" />
                    {c.name}
                  </CardTitle>
                </CardHeader>
                <CardContent className="flex items-center justify-between">
                  <Badge variant="secondary" className="gap-1">
                    <Users className="size-3" />
                    {c.leadCount}
                  </Badge>
                  <Button asChild size="sm" disabled={c.leadCount === 0}>
                    <Link href={`/dial?campaign=${c.id}`}>
                      <PhoneCall className="size-4" />
                      Start
                    </Link>
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// Cap per-lead history shipped to the client (keeps the page payload bounded on
// heavily-dialed campaigns). Most recent N calls — plenty for context.
const HISTORY_CAP = 10;

/**
 * Per-lead call data, all from a single query: the most recent call (last
 * reach-out chip), the set of leads called within the once-per-day window, and
 * the full recent history (outcome / note / duration / rep, newest first) for
 * the cockpit History tab. Time is read here (not in a component render) so it
 * stays out of the purity-checked render path.
 */
async function latestCalls(
  leadIds: string[],
): Promise<{
  last: Map<string, LastCall>;
  // leadId → ISO time the most recent "Left voicemail" outcome was logged. Lets
  // the cockpit show how long it's been since you left a VM, so you can pace
  // them (e.g. ~once every couple weeks) instead of every attempt.
  lastVoicemail: Map<string, string>;
  // Leads currently "resting" — called recently enough that the escalating
  // backoff (restMsFor) keeps them out of the queue for now. Supersedes the old
  // flat 24h gate: every lead still rests ≥1 day, repeat no-contacts rest longer.
  restingIds: Set<string>;
  nowMs: number;
  history: Map<string, CallHistoryItem[]>;
}> {
  // Time is read here (a plain async fn, not a component render) so the
  // purity-checked render path stays free of Date.now().
  const nowMs = Date.now();
  const last = new Map<string, LastCall>();
  const lastVoicemail = new Map<string, string>();
  const restingIds = new Set<string>();
  // leadId → how many no-contact attempts it's had, for the escalating backoff.
  const noContact = new Map<string, number>();
  const history = new Map<string, CallHistoryItem[]>();
  if (!leadIds.length) return { last, lastVoicemail, restingIds, nowMs, history };

  const rows = await db
    .select({
      leadId: callLogs.leadId,
      outcome: callLogs.outcome,
      notes: callLogs.notes,
      startedAt: callLogs.startedAt,
      durationSec: callLogs.durationSec,
      by: user.name,
      analysis: callTranscripts.analysis,
    })
    .from(callLogs)
    .leftJoin(user, eq(user.id, callLogs.userId))
    .leftJoin(callTranscripts, eq(callTranscripts.callLogId, callLogs.id))
    .where(inArray(callLogs.leadId, leadIds))
    .orderBy(desc(callLogs.startedAt));

  for (const r of rows) {
    if (!last.has(r.leadId)) {
      last.set(r.leadId, { outcome: r.outcome, note: r.notes, at: r.startedAt.toISOString() });
    }
    if (r.outcome && NO_CONTACT_OUTCOMES.has(r.outcome)) {
      noContact.set(r.leadId, (noContact.get(r.leadId) ?? 0) + 1);
    }
    // Rows are newest-first, so the first voicemail we see per lead is the latest.
    if (r.outcome === "voicemail" && !lastVoicemail.has(r.leadId)) {
      lastVoicemail.set(r.leadId, r.startedAt.toISOString());
    }
    const item: CallHistoryItem = {
      at: r.startedAt.toISOString(),
      outcome: r.outcome,
      note: r.notes,
      durationSec: r.durationSec,
      by: r.by,
      analysis: trimAnalysis(r.analysis),
    };
    const h = history.get(r.leadId);
    if (!h) history.set(r.leadId, [item]);
    else if (h.length < HISTORY_CAP) h.push(item);
  }
  // A lead rests until lastCall + restMsFor(...). Repeat no-contacts rest longer;
  // everyone rests ≥1 day (the old flat gate is just the floor now).
  for (const [leadId, lc] of last) {
    const restMs = restMsFor(noContact.get(leadId) ?? 0, lc.outcome);
    if (Date.parse(lc.at) + restMs > nowMs) restingIds.add(leadId);
  }
  return { last, lastVoicemail, restingIds, nowMs, history };
}

function NothingToDial({
  campaignId,
  name,
  total,
  resting,
}: {
  campaignId: string;
  name: string;
  total: number;
  resting: number;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 p-16 text-center">
      <CheckCircle2 className="size-12 text-green-600" />
      <div>
        <h2 className="text-xl font-semibold">Nothing fresh to dial right now</h2>
        <p className="mt-1 max-w-md text-sm text-muted-foreground">
          {resting > 0 ? (
            <>
              Everyone else in {name} is booked, opted-out, or{" "}
              <strong>
                {resting} {resting === 1 ? "lead is" : "leads are"} resting
              </strong>{" "}
              after a recent call — they’ll come back over the next few days. Add more leads, or
              dial the resting ones now if you want.
            </>
          ) : (
            <>
              Everyone in {name} is booked, opted-out, or just called. Check back soon or add more
              leads.
            </>
          )}
        </p>
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        {resting > 0 && (
          <Button asChild variant="outline">
            <Link href={`/dial?campaign=${campaignId}&resting=1`}>Dial {resting} resting now</Link>
          </Button>
        )}
        <Button asChild variant="outline">
          <Link href={`/campaigns/${campaignId}/leads`}>View {total} leads</Link>
        </Button>
        <Button asChild>
          <Link href="/">Back to Today</Link>
        </Button>
      </div>
    </div>
  );
}
