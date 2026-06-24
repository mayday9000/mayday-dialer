import Link from "next/link";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { campaigns, scripts, userCampaignScripts } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth-server";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SetPrimaryButton } from "./set-primary";
import { UseScriptButton, DuplicateScriptButton } from "./script-row-actions";
import { FileText, Plus, Pencil, Star } from "lucide-react";

export default async function CampaignScriptsPage(props: PageProps<"/campaigns/[id]">) {
  const user = await requireUser();
  const { id } = await props.params;

  const [campaign, rows, pick] = await Promise.all([
    db.query.campaigns.findFirst({ where: eq(campaigns.id, id) }),
    db.select().from(scripts).where(eq(scripts.campaignId, id)).orderBy(scripts.name),
    db
      .select({ scriptId: userCampaignScripts.scriptId })
      .from(userCampaignScripts)
      .where(and(eq(userCampaignScripts.userId, user.id), eq(userCampaignScripts.campaignId, id)))
      .limit(1),
  ]);

  const isAdmin = user.role === "admin";
  // What this rep effectively dials: their pick, else the campaign default.
  const usingId = pick[0]?.scriptId ?? campaign?.scriptId ?? rows[0]?.id ?? null;

  return (
    <div className="space-y-4 p-6">
      <div className="flex items-start justify-between gap-3">
        <p className="max-w-prose text-sm text-muted-foreground">
          A shared library — everyone sees every script. Pick the one{" "}
          <span className="font-medium text-foreground">you</span> dial with; your choice only
          affects you. To tweak someone else&apos;s, duplicate it into your own copy.
        </p>
        <Button asChild>
          <Link href={`/campaigns/${id}/scripts/new`}>
            <Plus className="size-4" />
            New script
          </Link>
        </Button>
      </div>

      {rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed py-16 text-center">
          <FileText className="size-8 text-muted-foreground" />
          <div className="text-sm text-muted-foreground">No scripts yet.</div>
          <Button asChild variant="outline" size="sm">
            <Link href={`/campaigns/${id}/scripts/new`}>Write or upload one</Link>
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          {rows.map((s) => {
            const isPrimary = campaign?.scriptId === s.id;
            const inUse = usingId === s.id;
            const isOwner = s.createdBy === user.id;
            const canEdit = isOwner || isAdmin;
            return (
              <Card key={s.id}>
                <CardContent className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <Link
                    href={`/campaigns/${id}/scripts/${s.id}`}
                    className="flex min-w-0 items-center gap-2 hover:underline"
                  >
                    <FileText className="size-4 shrink-0 text-muted-foreground" />
                    <span className="truncate font-medium">{s.name}</span>
                    {isPrimary && (
                      <Badge variant="secondary" className="gap-1">
                        <Star className="size-3" /> Default
                      </Badge>
                    )}
                    {isOwner && (
                      <Badge variant="outline" className="text-muted-foreground">
                        Yours
                      </Badge>
                    )}
                  </Link>
                  <div className="flex shrink-0 items-center gap-2">
                    <UseScriptButton campaignId={id} scriptId={s.id} inUse={inUse} />
                    {isAdmin && (
                      <SetPrimaryButton campaignId={id} scriptId={s.id} isPrimary={isPrimary} />
                    )}
                    <DuplicateScriptButton campaignId={id} scriptId={s.id} />
                    {canEdit && (
                      <Button asChild variant="ghost" size="icon" className="size-8" title="Edit">
                        <Link href={`/campaigns/${id}/scripts/${s.id}`}>
                          <Pencil className="size-4" />
                        </Link>
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
