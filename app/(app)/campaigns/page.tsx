import Link from "next/link";
import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { campaigns, campaignLeads, scripts } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth-server";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Megaphone, Users, FileText } from "lucide-react";
import { CampaignCreateDialog } from "./campaign-create-dialog";
import { countLeadsByStatus } from "./actions";

export default async function CampaignsPage() {
  await requireUser();

  const [rows, scriptList, leadCounts] = await Promise.all([
    db
      .select({
        id: campaigns.id,
        name: campaigns.name,
        description: campaigns.description,
        scriptName: scripts.name,
        leadCount: sql<number>`count(${campaignLeads.id})::int`,
      })
      .from(campaigns)
      .leftJoin(campaignLeads, eq(campaignLeads.campaignId, campaigns.id))
      .leftJoin(scripts, eq(scripts.id, campaigns.scriptId))
      .groupBy(campaigns.id, scripts.name)
      .orderBy(desc(campaigns.createdAt)),
    db.select({ id: scripts.id, name: scripts.name }).from(scripts).orderBy(scripts.name),
    countLeadsByStatus(),
  ]);

  return (
    <div className="flex flex-col">
      <PageHeader title="Campaigns" description="Sets of leads to dial through.">
        <CampaignCreateDialog scripts={scriptList} leadCounts={leadCounts} />
      </PageHeader>

      <div className="p-6">
        {rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed py-20 text-center">
            <Megaphone className="size-8 text-muted-foreground" />
            <div className="text-sm text-muted-foreground">No campaigns yet.</div>
            <div className="text-xs text-muted-foreground">
              Create one to start a dial session.
            </div>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {rows.map((c) => (
              <Link key={c.id} href={`/campaigns/${c.id}`}>
                <Card className="h-full transition-colors hover:border-primary/50">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <Megaphone className="size-4 text-muted-foreground" />
                      {c.name}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {c.description && (
                      <p className="line-clamp-2 text-sm text-muted-foreground">{c.description}</p>
                    )}
                    <div className="flex flex-wrap gap-2">
                      <Badge variant="secondary" className="gap-1">
                        <Users className="size-3" />
                        {c.leadCount} lead{c.leadCount === 1 ? "" : "s"}
                      </Badge>
                      {c.scriptName && (
                        <Badge variant="outline" className="gap-1">
                          <FileText className="size-3" />
                          {c.scriptName}
                        </Badge>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
