import { requireUser } from "@/lib/auth-server";
import { ImportClient } from "@/app/(app)/leads/import/import-client";

export default async function CampaignImportPage(props: PageProps<"/campaigns/[id]/leads/import">) {
  await requireUser();
  const { id } = await props.params;
  return (
    <div className="p-4 md:p-6">
      <p className="mb-4 text-sm text-muted-foreground">
        Imported leads are de-duplicated on phone and added to this campaign.
      </p>
      <ImportClient campaignId={id} />
    </div>
  );
}
