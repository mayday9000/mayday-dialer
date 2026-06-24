import { notFound, redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { scripts } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth-server";
import { ScriptEditor } from "@/app/(app)/scripts/script-editor";

export default async function EditCampaignScriptPage(
  props: PageProps<"/campaigns/[id]/scripts/[scriptId]">,
) {
  const user = await requireUser();
  const { id, scriptId } = await props.params;

  const script = await db.query.scripts.findFirst({ where: eq(scripts.id, scriptId) });
  if (!script) notFound();

  // Only the author (or an admin) edits a script; everyone else duplicates.
  if (script.createdBy !== user.id && user.role !== "admin") {
    redirect(`/campaigns/${id}/scripts`);
  }

  return (
    <div className="max-w-4xl p-6">
      <ScriptEditor
        initial={{ id: script.id, name: script.name, contentMarkdown: script.contentMarkdown }}
        campaignId={id}
        returnHref={`/campaigns/${id}/scripts`}
      />
    </div>
  );
}
