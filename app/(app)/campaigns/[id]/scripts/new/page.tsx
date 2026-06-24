import { requireUser } from "@/lib/auth-server";
import { ScriptEditor } from "@/app/(app)/scripts/script-editor";

export default async function NewCampaignScriptPage(props: PageProps<"/campaigns/[id]/scripts/new">) {
  await requireUser();
  const { id } = await props.params;
  return (
    <div className="max-w-4xl p-6">
      <ScriptEditor campaignId={id} returnHref={`/campaigns/${id}/scripts`} />
    </div>
  );
}
