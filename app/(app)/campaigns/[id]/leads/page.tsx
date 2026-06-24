import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { campaignLeads, campaignMarkets, leads, callLogs } from "@/lib/db/schema";
import { user } from "@/lib/db/auth-schema";
import { requireUser } from "@/lib/auth-server";
import { CampaignActions, AddFromCampaignButton } from "../campaign-detail-client";
import { listShareableCampaigns } from "../../actions";
import { LeadsTable, type TableLead } from "./leads-table";

/** Most recent call per lead (outcome + when), for the "Last called" column. */
async function lastCallByLead(
  leadIds: string[],
): Promise<Map<string, { at: string; outcome: string | null }>> {
  const m = new Map<string, { at: string; outcome: string | null }>();
  if (!leadIds.length) return m;
  const rows = await db
    .select({
      leadId: callLogs.leadId,
      outcome: callLogs.outcome,
      startedAt: callLogs.startedAt,
    })
    .from(callLogs)
    .where(inArray(callLogs.leadId, leadIds))
    .orderBy(desc(callLogs.startedAt));
  for (const r of rows) {
    if (!m.has(r.leadId)) m.set(r.leadId, { at: r.startedAt.toISOString(), outcome: r.outcome });
  }
  return m;
}

export default async function CampaignLeadsPage(props: PageProps<"/campaigns/[id]">) {
  await requireUser();
  const { id } = await props.params;

  const rows = await db
    .select({
      id: leads.id,
      companyName: leads.companyName,
      contactName: leads.contactName,
      title: leads.title,
      phone: leads.phone,
      email: leads.email,
      website: leads.website,
      status: leads.status,
      archived: leads.archived,
      source: leads.source,
      marketId: campaignLeads.marketId,
      customFields: leads.customFields,
      enrichment: leads.enrichment,
      ownerId: leads.ownerId,
      createdAt: leads.createdAt,
    })
    .from(campaignLeads)
    .innerJoin(leads, eq(leads.id, campaignLeads.leadId))
    .where(and(eq(campaignLeads.campaignId, id)))
    .orderBy(desc(campaignLeads.addedAt));

  const markets = await db
    .select({ id: campaignMarkets.id, name: campaignMarkets.name })
    .from(campaignMarkets)
    .where(eq(campaignMarkets.campaignId, id))
    .orderBy(desc(campaignMarkets.isDefault), asc(campaignMarkets.name));

  const leadIds = rows.map((r) => r.id);
  const ownerIds = [...new Set(rows.map((r) => r.ownerId).filter((v): v is string => !!v))];

  const [lastCalls, owners] = await Promise.all([
    lastCallByLead(leadIds),
    ownerIds.length
      ? db.select({ id: user.id, name: user.name }).from(user).where(inArray(user.id, ownerIds))
      : Promise.resolve([] as { id: string; name: string }[]),
  ]);
  const ownerName = new Map(owners.map((o) => [o.id, o.name]));
  const shareSources = await listShareableCampaigns(id);

  const tableLeads: TableLead[] = rows.map((r) => {
    const last = lastCalls.get(r.id) ?? null;
    return {
      id: r.id,
      companyName: r.companyName,
      contactName: r.contactName,
      title: r.title,
      phone: r.phone,
      email: r.email,
      website: r.website,
      status: r.status,
      archived: r.archived,
      source: r.source,
      marketId: r.marketId,
      city: r.customFields?.City ?? null,
      customFields: r.customFields ?? null,
      enrichment: r.enrichment ?? null,
      ownerName: r.ownerId ? (ownerName.get(r.ownerId) ?? null) : null,
      createdAt: r.createdAt.toISOString(),
      lastCallAt: last?.at ?? null,
      lastCallOutcome: last?.outcome ?? null,
    };
  });

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {tableLeads.length} lead{tableLeads.length === 1 ? "" : "s"} in this campaign
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <AddFromCampaignButton campaignId={id} sources={shareSources} />
          <CampaignActions campaignId={id} />
        </div>
      </div>

      <LeadsTable campaignId={id} leads={tableLeads} markets={markets} />
    </div>
  );
}
