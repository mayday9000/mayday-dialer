import Link from "next/link";
import { notFound } from "next/navigation";
import { eq, desc, inArray, asc } from "drizzle-orm";
import { db } from "@/lib/db";
import { leads, leadEvents, user, campaignLeads, campaigns, callTranscripts } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth-server";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { LeadStatusBadge } from "@/components/lead-status-badge";
import { formatPhone } from "@/lib/phone";
import { autoEngine } from "@/lib/transcription/config";
import type { TranscriptDTO } from "@/components/transcript-dialog";
import { LeadDetailClient, type LeadDTO, type EventDTO } from "./lead-detail-client";
import { ArrowLeft, PhoneCall } from "lucide-react";

export default async function LeadDetailPage(props: PageProps<"/leads/[id]">) {
  await requireUser();
  const { id } = await props.params;

  const lead = await db.query.leads.findFirst({ where: eq(leads.id, id) });
  if (!lead) notFound();

  const events = await db
    .select()
    .from(leadEvents)
    .where(eq(leadEvents.leadId, id))
    .orderBy(desc(leadEvents.createdAt))
    .limit(200);

  // Resolve author names in one query.
  const authorIds = [...new Set(events.map((e) => e.userId).filter(Boolean))] as string[];
  const authors = authorIds.length
    ? await db.select({ id: user.id, name: user.name }).from(user).where(inArray(user.id, authorIds))
    : [];
  const nameById = new Map(authors.map((a) => [a.id, a.name]));

  const leadDTO: LeadDTO = {
    id: lead.id,
    companyName: lead.companyName,
    contactName: lead.contactName,
    title: lead.title,
    phone: lead.phone,
    email: lead.email,
    website: lead.website,
    status: lead.status,
    callbackAt: lead.callbackAt ? lead.callbackAt.toISOString() : null,
    customFields: lead.customFields ?? null,
    source: lead.source,
  };

  const eventDTOs: EventDTO[] = events.map((e) => ({
    id: e.id,
    type: e.type,
    body: e.body,
    outcome: e.outcome,
    createdAt: e.createdAt.toISOString(),
    authorName: e.userId ? nameById.get(e.userId) ?? null : null,
    recordingSid:
      e.type === "voicemail" && e.metadata
        ? ((e.metadata as Record<string, unknown>).recordingSid as string) ?? null
        : null,
    ai: !!(e.metadata && (e.metadata as Record<string, unknown>).ai),
  }));

  // Recordings + transcripts for this lead (newest first).
  const transcriptRows = await db
    .select()
    .from(callTranscripts)
    .where(eq(callTranscripts.leadId, id))
    .orderBy(desc(callTranscripts.createdAt))
    .limit(50);
  const transcripts: (TranscriptDTO & { createdAt: string })[] = transcriptRows.map((t) => ({
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
    createdAt: t.createdAt.toISOString(),
  }));
  const engineConfigured = autoEngine() !== null;

  const heading = lead.companyName || lead.contactName || formatPhone(lead.phone) || "Lead";

  // Campaign-centric: link back to the lead's first campaign (no global list).
  const firstCampaign = await db
    .select({ id: campaigns.id, name: campaigns.name })
    .from(campaignLeads)
    .innerJoin(campaigns, eq(campaigns.id, campaignLeads.campaignId))
    .where(eq(campaignLeads.leadId, id))
    .orderBy(asc(campaignLeads.addedAt))
    .limit(1);
  const backHref = firstCampaign[0] ? `/campaigns/${firstCampaign[0].id}/leads` : "/";
  const backLabel = firstCampaign[0]?.name ?? "Today";

  return (
    <div className="flex flex-col">
      <PageHeader title={heading} description={lead.contactName && lead.companyName ? lead.contactName : undefined}>
        <Button asChild variant="outline" size="sm">
          <Link href={backHref}>
            <ArrowLeft className="size-4 shrink-0" />
            <span className="max-w-28 truncate sm:max-w-none">{backLabel}</span>
          </Link>
        </Button>
        <Button asChild size="sm">
          <Link href={`/dial?lead=${lead.id}`}>
            <PhoneCall className="size-4" />
            Call
          </Link>
        </Button>
      </PageHeader>

      <div className="flex flex-wrap items-center gap-3 px-4 pt-4 md:px-6">
        <LeadStatusBadge status={lead.status} archived={lead.archived} />
        {lead.phone && <span className="text-sm tabular-nums text-muted-foreground">{formatPhone(lead.phone)}</span>}
        {lead.source && <span className="text-xs text-muted-foreground">· from {lead.source}</span>}
      </div>

      <div className="p-4 pt-4 md:p-6">
        <LeadDetailClient
          lead={leadDTO}
          events={eventDTOs}
          backHref={backHref}
          transcripts={transcripts}
          engineConfigured={engineConfigured}
        />
      </div>
    </div>
  );
}
