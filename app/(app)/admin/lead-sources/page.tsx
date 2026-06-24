import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { harvestSearches, campaigns, leads } from "@/lib/db/schema";
import { requireAdmin } from "@/lib/auth-server";
import { PageHeader } from "@/components/page-header";
import { isPlacesConfigured, isLlmConfigured } from "@/lib/harvest/config";
import { LeadSourcesClient, type SearchRow } from "./lead-sources-client";

export default async function LeadSourcesPage() {
  await requireAdmin();

  const [searches, camps, pendingRows] = await Promise.all([
    db.select().from(harvestSearches).orderBy(desc(harvestSearches.createdAt)),
    db
      .select({ id: campaigns.id, name: campaigns.name })
      .from(campaigns)
      .orderBy(desc(campaigns.createdAt)),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(leads)
      .where(eq(leads.reviewState, "pending")),
  ]);
  const pendingCount = pendingRows[0]?.count ?? 0;

  const rows: SearchRow[] = searches.map((s) => ({
    id: s.id,
    label: s.label,
    location: s.location,
    state: s.state,
    keywords: s.keywords,
    extraLocations: s.extraLocations ?? [],
    radiusMeters: s.radiusMeters,
    targetCampaignId: s.targetCampaignId,
    requireWebsite: s.requireWebsite,
    requirePhone: s.requirePhone,
    minRating: s.minRating,
    minReviews: s.minReviews,
    maxPerRun: s.maxPerRun,
    customRules: s.customRules,
    minDialable: s.minDialable,
    active: s.active,
    lastRunAt: s.lastRunAt ? s.lastRunAt.toISOString() : null,
    lastStats: s.lastStats ?? {},
  }));

  return (
    <div className="flex flex-col">
      <PageHeader
        title="Lead sources"
        description="Set where new leads come from. Run on demand, or let them auto-refill a campaign."
      />
      <div className="p-6">
        <LeadSourcesClient
          searches={rows}
          campaigns={camps}
          placesOn={isPlacesConfigured()}
          llmOn={isLlmConfigured()}
          pendingCount={pendingCount}
        />
      </div>
    </div>
  );
}
