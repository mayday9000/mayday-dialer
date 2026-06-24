import { asc, desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  campaigns,
  campaignMarkets,
  campaignLeads,
  campaignNumbers,
  type CampaignBrief,
} from "@/lib/db/schema";
import { requireUser } from "@/lib/auth-server";
import { CitiesClient, type CityVM } from "./cities-client";

export default async function CampaignCitiesPage(props: PageProps<"/campaigns/[id]">) {
  await requireUser();
  const { id } = await props.params;

  const [campaign, marketRows, leadCountRows, numberRows] = await Promise.all([
    db.query.campaigns.findFirst({ where: eq(campaigns.id, id) }),
    db
      .select()
      .from(campaignMarkets)
      .where(eq(campaignMarkets.campaignId, id))
      .orderBy(desc(campaignMarkets.isDefault), asc(campaignMarkets.createdAt)),
    db
      .select({ marketId: campaignLeads.marketId, n: sql<number>`count(*)::int` })
      .from(campaignLeads)
      .where(eq(campaignLeads.campaignId, id))
      .groupBy(campaignLeads.marketId),
    db
      .select({ marketId: campaignNumbers.marketId, e164: campaignNumbers.e164 })
      .from(campaignNumbers)
      .where(eq(campaignNumbers.campaignId, id))
      .orderBy(desc(campaignNumbers.createdAt)),
  ]);

  const leadCount = new Map<string, number>();
  for (const r of leadCountRows) if (r.marketId) leadCount.set(r.marketId, r.n);
  const numberByMarket = new Map<string, string>();
  for (const n of numberRows) {
    if (n.marketId && !numberByMarket.has(n.marketId)) numberByMarket.set(n.marketId, n.e164);
  }

  const cities: CityVM[] = marketRows.map((m) => ({
    id: m.id,
    name: m.name,
    location: m.location,
    state: m.state,
    active: m.active,
    isDefault: m.isDefault,
    leadCount: leadCount.get(m.id) ?? 0,
    number: numberByMarket.get(m.id) ?? null,
  }));

  const brief = (campaign?.briefData ?? null) as CampaignBrief | null;

  return (
    <CitiesClient
      campaignId={id}
      cities={cities}
      suggestedAreaCodes={brief?.areaCodes ?? []}
      defaultKeywords={brief?.keywords ?? ""}
    />
  );
}
