import Link from "next/link";
import { notFound } from "next/navigation";
import { eq, and, gte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { campaigns, campaignLeads, leads, scripts, bookings } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth-server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MarkdownView } from "@/components/markdown-view";
import { LeadStatusBadge } from "@/components/lead-status-badge";
import { CampaignMetaEditor } from "./meta-editor";
import { GenerateBriefButton } from "./generate-brief-button";
import { Users, FileText, CalendarClock, UserRound, ArrowRight, Star } from "lucide-react";

export default async function CampaignOverviewPage(props: PageProps<"/campaigns/[id]">) {
  const user = await requireUser();
  const { id } = await props.params;

  const campaign = await db.query.campaigns.findFirst({ where: eq(campaigns.id, id) });
  if (!campaign) notFound();

  const now = new Date();
  const [members, campaignScripts, bookingCountRow] = await Promise.all([
    db
      .select({
        leadId: leads.id,
        companyName: leads.companyName,
        contactName: leads.contactName,
        title: leads.title,
        status: leads.status,
        archived: leads.archived,
      })
      .from(campaignLeads)
      .innerJoin(leads, eq(leads.id, campaignLeads.leadId))
      .where(eq(campaignLeads.campaignId, id)),
    db.select().from(scripts).where(eq(scripts.campaignId, id)).orderBy(scripts.name),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(bookings)
      .innerJoin(campaignLeads, eq(campaignLeads.leadId, bookings.leadId))
      .where(
        and(
          eq(campaignLeads.campaignId, id),
          eq(bookings.userId, user.id),
          eq(bookings.status, "scheduled"),
          gte(bookings.startAt, now),
        ),
      ),
  ]);

  const decisionMakers = members.filter((m) => m.contactName && !m.archived);
  const upcomingBookings = bookingCountRow[0]?.count ?? 0;

  const stats = [
    { label: "Leads", value: members.length, icon: Users, href: `/campaigns/${id}/leads` },
    { label: "Decision-makers", value: decisionMakers.length, icon: UserRound, href: `/campaigns/${id}/leads` },
    { label: "Scripts", value: campaignScripts.length, icon: FileText, href: `/campaigns/${id}/scripts` },
    { label: "Upcoming bookings", value: upcomingBookings, icon: CalendarClock, href: `/campaigns/${id}/bookings` },
  ];

  return (
    <div className="grid gap-6 p-4 md:p-6 lg:grid-cols-[1fr_320px]">
      {/* Left: brief + decision makers */}
      <div className="space-y-6">
        <Card>
          <CardHeader className="flex-row items-start justify-between space-y-0">
            <div>
              <CardTitle className="text-base">Caller brief</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">
                {campaign.description || "What you're selling and who you're selling to."}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <GenerateBriefButton id={id} hasBrief={!!campaign.brief} />
              <CampaignMetaEditor
                id={id}
                initial={{
                  name: campaign.name,
                  description: campaign.description ?? "",
                  brief: campaign.brief ?? "",
                  location: campaign.location ?? "",
                  industry: campaign.industry ?? "",
                  meetingTitleTemplate: campaign.meetingTitleTemplate ?? "",
                  meetingDescriptionTemplate: campaign.meetingDescriptionTemplate ?? "",
                  meetingDurationMin: String(campaign.meetingDurationMin ?? 30),
                  meetingLocation: campaign.meetingLocation ?? "",
                }}
              />
            </div>
          </CardHeader>
          <CardContent>
            {campaign.brief ? (
              <MarkdownView>{campaign.brief}</MarkdownView>
            ) : (
              <div className="flex flex-col items-start gap-3 rounded-md border border-dashed p-4">
                <p className="text-sm text-muted-foreground">
                  No brief yet. Generate a caller study sheet — the audience, their pain points,
                  the offer, and the objections you&apos;ll hear — so anyone can pick up this
                  campaign and know exactly what they&apos;re selling and to whom.
                </p>
                <GenerateBriefButton id={id} hasBrief={false} />
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="flex items-center gap-2 text-base">
              <UserRound className="size-4 text-muted-foreground" />
              Decision-makers
            </CardTitle>
            <Button asChild variant="ghost" size="sm">
              <Link href={`/campaigns/${id}/leads`}>
                All leads <ArrowRight className="size-3.5" />
              </Link>
            </Button>
          </CardHeader>
          <CardContent>
            {decisionMakers.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">
                No named contacts yet.
              </p>
            ) : (
              <ul className="divide-y">
                {decisionMakers.slice(0, 12).map((m) => (
                  <li key={m.leadId} className="flex items-center justify-between gap-3 py-2">
                    <Link href={`/leads/${m.leadId}`} className="min-w-0 hover:underline">
                      <div className="truncate text-sm font-medium">{m.contactName}</div>
                      <div className="truncate text-xs text-muted-foreground">
                        {[m.title, m.companyName].filter(Boolean).join(" · ")}
                      </div>
                    </Link>
                    <LeadStatusBadge status={m.status} archived={m.archived} />
                  </li>
                ))}
              </ul>
            )}
            {decisionMakers.length > 12 && (
              <p className="pt-2 text-center text-xs text-muted-foreground">
                + {decisionMakers.length - 12} more
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Right: stats + scripts */}
      <div className="space-y-6">
        <div className="grid grid-cols-2 gap-3">
          {stats.map((s) => {
            const Icon = s.icon;
            return (
              <Link key={s.label} href={s.href}>
                <Card className="transition-colors hover:border-primary/50">
                  <CardContent className="py-4">
                    <Icon className="size-4 text-muted-foreground" />
                    <div className="mt-2 text-2xl font-semibold tabular-nums">{s.value}</div>
                    <div className="text-xs text-muted-foreground">{s.label}</div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>

        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="flex items-center gap-2 text-base">
              <FileText className="size-4 text-muted-foreground" />
              Scripts
            </CardTitle>
            <Button asChild variant="ghost" size="sm">
              <Link href={`/campaigns/${id}/scripts`}>
                Manage <ArrowRight className="size-3.5" />
              </Link>
            </Button>
          </CardHeader>
          <CardContent className="space-y-2">
            {campaignScripts.length === 0 ? (
              <p className="py-2 text-sm text-muted-foreground">No scripts yet.</p>
            ) : (
              campaignScripts.map((s) => (
                <Link
                  key={s.id}
                  href={`/campaigns/${id}/scripts/${s.id}`}
                  className="flex items-center justify-between rounded-md border px-3 py-2 text-sm hover:bg-accent"
                >
                  <span className="truncate">{s.name}</span>
                  {campaign.scriptId === s.id && (
                    <Badge variant="secondary" className="gap-1">
                      <Star className="size-3" /> Primary
                    </Badge>
                  )}
                </Link>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
