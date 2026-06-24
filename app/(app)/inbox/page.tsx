import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { voicemails, leads, campaignMarkets, campaigns } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth-server";
import { PageHeader } from "@/components/page-header";
import { InboxClient, type VoicemailVM } from "./inbox-client";

const LIMIT = 100;

export default async function InboxPage() {
  await requireUser();

  const rows = await db
    .select({
      id: voicemails.id,
      leadId: voicemails.leadId,
      company: leads.companyName,
      contact: leads.contactName,
      fromPhone: voicemails.fromPhone,
      cityName: campaignMarkets.name,
      campaignName: campaigns.name,
      recordingSid: voicemails.recordingSid,
      durationSec: voicemails.durationSec,
      transcriptStatus: voicemails.transcriptStatus,
      transcriptText: voicemails.transcriptText,
      handled: voicemails.handled,
      createdAt: voicemails.createdAt,
    })
    .from(voicemails)
    .leftJoin(leads, eq(leads.id, voicemails.leadId))
    .leftJoin(campaignMarkets, eq(campaignMarkets.id, voicemails.marketId))
    .leftJoin(campaigns, eq(campaigns.id, voicemails.campaignId))
    // Newest first; the client groups unhandled vs handled.
    .orderBy(desc(voicemails.createdAt))
    .limit(LIMIT);

  const items: VoicemailVM[] = rows.map((r) => ({
    id: r.id,
    leadId: r.leadId,
    name: r.company || r.contact || null,
    fromPhone: r.fromPhone,
    cityName: r.cityName,
    campaignName: r.campaignName,
    recordingSid: r.recordingSid,
    durationSec: r.durationSec,
    transcriptStatus: r.transcriptStatus,
    transcriptText: r.transcriptText,
    handled: r.handled,
    createdAt: r.createdAt.toISOString(),
  }));

  return (
    <div className="flex flex-col">
      <PageHeader
        title="Inbox"
        description="Voicemails left on your campaign numbers — listen, read, and call back."
      />
      <div className="p-4 md:p-6">
        <InboxClient items={items} />
      </div>
    </div>
  );
}
