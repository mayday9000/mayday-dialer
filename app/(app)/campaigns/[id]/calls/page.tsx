import Link from "next/link";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { format } from "date-fns";
import { db } from "@/lib/db";
import { callLogs, campaignMarkets, leads, callTranscripts } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth-server";
import { CallsCityFilter } from "./calls-city-filter";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { outcomeLabel } from "@/lib/dial";
import { formatPhone } from "@/lib/phone";
import { autoEngine } from "@/lib/transcription/config";
import { TranscriptDialog, type TranscriptDTO } from "@/components/transcript-dialog";
import { History } from "lucide-react";

const LIMIT = 100;

function fmtDuration(s: number | null): string {
  if (!s || s <= 0) return "—";
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

export default async function CampaignCallsPage(props: PageProps<"/campaigns/[id]">) {
  await requireUser();
  const { id } = await props.params;
  const sp = await props.searchParams;
  const market = typeof sp.market === "string" ? sp.market : undefined;
  const where = and(
    eq(callLogs.campaignId, id),
    market ? eq(callLogs.marketId, market) : undefined,
  );

  const [rows, countRows, markets] = await Promise.all([
    db
      .select({
        id: callLogs.id,
        leadId: callLogs.leadId,
        company: leads.companyName,
        contact: leads.contactName,
        phone: leads.phone,
        outcome: callLogs.outcome,
        durationSec: callLogs.durationSec,
        recordingSid: callLogs.recordingSid,
        notes: callLogs.notes,
        startedAt: callLogs.startedAt,
      })
      .from(callLogs)
      .innerJoin(leads, eq(leads.id, callLogs.leadId))
      .where(where)
      .orderBy(desc(callLogs.startedAt))
      .limit(LIMIT),
    db.select({ n: sql<number>`count(*)::int` }).from(callLogs).where(where),
    db
      .select({ id: campaignMarkets.id, name: campaignMarkets.name })
      .from(campaignMarkets)
      .where(eq(campaignMarkets.campaignId, id))
      .orderBy(desc(campaignMarkets.isDefault), asc(campaignMarkets.name)),
  ]);
  const total = countRows[0]?.n ?? 0;

  // Transcripts for the call logs on this page, keyed by callLogId.
  const logIds = rows.map((r) => r.id);
  const transcripts = logIds.length
    ? await db.select().from(callTranscripts).where(inArray(callTranscripts.callLogId, logIds))
    : [];
  const byLog = new Map<string, TranscriptDTO>();
  for (const t of transcripts) {
    if (t.callLogId) byLog.set(t.callLogId, toDTO(t));
  }
  const engineConfigured = autoEngine() !== null;

  const renderTranscript = (r: (typeof rows)[number]) => {
    const t = byLog.get(r.id) ?? null;
    const showTranscript = !!t || !!r.recordingSid;
    return showTranscript ? (
      <TranscriptDialog
        transcript={t}
        leadId={r.leadId}
        callLogId={r.id}
        recordingSid={r.recordingSid}
        engineConfigured={engineConfigured}
      />
    ) : (
      <TranscriptDialog
        transcript={null}
        leadId={r.leadId}
        callLogId={r.id}
        engineConfigured={engineConfigured}
        triggerLabel="Add"
      />
    );
  };

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {total} call{total === 1 ? "" : "s"} logged
          {total > LIMIT ? ` · showing the latest ${LIMIT}` : ""}
        </p>
        {markets.length > 1 && <CallsCityFilter markets={markets} value={market ?? "all"} />}
      </div>

      {rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed py-16 text-center">
          <History className="size-8 text-muted-foreground" />
          <div className="text-sm text-muted-foreground">No calls logged yet.</div>
        </div>
      ) : (
        <>
          {/* Mobile: stacked cards */}
          <div className="space-y-3 md:hidden">
            {rows.map((r) => (
              <Card key={r.id} size="sm">
                <CardContent className="space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <Link
                      href={`/leads/${r.leadId}`}
                      className="min-w-0 font-medium hover:underline"
                    >
                      <div className="truncate">{r.company || formatPhone(r.phone) || "—"}</div>
                      {r.contact && (
                        <div className="truncate text-xs font-normal text-muted-foreground">
                          {r.contact}
                        </div>
                      )}
                    </Link>
                    {r.outcome ? (
                      <Badge variant="secondary" className="shrink-0">
                        {outcomeLabel(r.outcome)}
                      </Badge>
                    ) : null}
                  </div>

                  <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                    <span>{format(r.startedAt, "MMM d, p")}</span>
                    <span className="tabular-nums">{fmtDuration(r.durationSec)}</span>
                  </div>

                  {r.notes && (
                    <p className="text-sm text-muted-foreground">{r.notes}</p>
                  )}

                  <div className="flex min-h-10 items-center pt-1">{renderTranscript(r)}</div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Desktop: table */}
          <div className="hidden rounded-md border md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="whitespace-nowrap">When</TableHead>
                  <TableHead>Company</TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead>Outcome</TableHead>
                  <TableHead className="text-right">Duration</TableHead>
                  <TableHead>Transcript</TableHead>
                  <TableHead>Notes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {format(r.startedAt, "MMM d, p")}
                    </TableCell>
                    <TableCell className="font-medium">
                      <Link href={`/leads/${r.leadId}`} className="hover:underline">
                        {r.company || formatPhone(r.phone) || "—"}
                      </Link>
                    </TableCell>
                    <TableCell>{r.contact || "—"}</TableCell>
                    <TableCell>
                      {r.outcome ? (
                        <Badge variant="secondary">{outcomeLabel(r.outcome)}</Badge>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{fmtDuration(r.durationSec)}</TableCell>
                    <TableCell>{renderTranscript(r)}</TableCell>
                    <TableCell className="max-w-xs truncate text-muted-foreground" title={r.notes ?? ""}>
                      {r.notes || "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </div>
  );
}

function toDTO(t: typeof callTranscripts.$inferSelect): TranscriptDTO {
  return {
    id: t.id,
    status: t.status,
    source: t.source,
    segments: t.segments ?? [],
    text: t.text,
    recordingSid: t.recordingSid,
    language: t.language,
    callLogId: t.callLogId,
    leadId: t.leadId,
    callSid: t.callSid,
    error: t.error,
    analysis: t.analysis ?? {},
  };
}
