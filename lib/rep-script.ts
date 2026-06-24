import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { scripts, userCampaignScripts } from "@/lib/db/schema";

/** One script in a campaign's shared library, light enough to ship to the
 *  client so the cockpit can switch scripts instantly. */
export type ScriptOption = { id: string; name: string; contentMarkdown: string };

export type RepScript = {
  options: ScriptOption[]; // the campaign's shared library, A→Z
  selectedScriptId: string | null; // the one THIS rep dials with
  markdown: string | null; // its content (the active script)
};

/**
 * Resolve which script a rep dials for a campaign:
 *   their personal pick → the campaign's primary → the first script.
 * The full library comes back too, so the dialer can offer an instant switcher.
 */
export async function loadRepScript(
  userId: string,
  campaignId: string,
  primaryScriptId: string | null,
): Promise<RepScript> {
  const [options, pick] = await Promise.all([
    db
      .select({ id: scripts.id, name: scripts.name, contentMarkdown: scripts.contentMarkdown })
      .from(scripts)
      .where(eq(scripts.campaignId, campaignId))
      .orderBy(scripts.name),
    db
      .select({ scriptId: userCampaignScripts.scriptId })
      .from(userCampaignScripts)
      .where(
        and(eq(userCampaignScripts.userId, userId), eq(userCampaignScripts.campaignId, campaignId)),
      )
      .limit(1),
  ]);

  const byId = new Map(options.map((o) => [o.id, o]));
  const picked = pick[0]?.scriptId && byId.has(pick[0].scriptId) ? pick[0].scriptId : null;
  const primary = primaryScriptId && byId.has(primaryScriptId) ? primaryScriptId : null;
  const selectedScriptId = picked ?? primary ?? options[0]?.id ?? null;

  // Fallback: a primary whose campaign_id differs from this campaign won't be in
  // `options` (legacy data) — fetch it directly so the rep still gets a script.
  let markdown = selectedScriptId ? (byId.get(selectedScriptId)?.contentMarkdown ?? null) : null;
  if (selectedScriptId && markdown == null) {
    const row = await db.query.scripts.findFirst({ where: eq(scripts.id, selectedScriptId) });
    markdown = row?.contentMarkdown ?? null;
  }

  return { options, selectedScriptId, markdown };
}
