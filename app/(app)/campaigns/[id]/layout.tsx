import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { campaigns } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth-server";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CampaignTabs } from "@/components/campaign-tabs";
import { MapPin, Building2, PhoneCall } from "lucide-react";

export default async function CampaignLayout(props: LayoutProps<"/campaigns/[id]">) {
  await requireUser();
  const { id } = await props.params;
  const campaign = await db.query.campaigns.findFirst({ where: eq(campaigns.id, id) });
  if (!campaign) notFound();

  return (
    <div className="flex flex-col">
      <div className="space-y-3 px-6 pt-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">{campaign.name}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              {campaign.industry && (
                <Badge variant="secondary" className="gap-1">
                  <Building2 className="size-3" />
                  {campaign.industry}
                </Badge>
              )}
              {campaign.location && (
                <Badge variant="secondary" className="gap-1">
                  <MapPin className="size-3" />
                  {campaign.location}
                </Badge>
              )}
            </div>
          </div>
          <Button asChild>
            <Link href={`/dial?campaign=${id}`}>
              <PhoneCall className="size-4" />
              Start dialing
            </Link>
          </Button>
        </div>
        <CampaignTabs id={id} />
      </div>
      {props.children}
    </div>
  );
}
