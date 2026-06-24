import Link from "next/link";
import { eq, and, asc, gte } from "drizzle-orm";
import { db } from "@/lib/db";
import { bookings, campaignLeads, leads } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth-server";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CalendarClock, ExternalLink } from "lucide-react";
import { format } from "date-fns";

export default async function CampaignBookingsPage(props: PageProps<"/campaigns/[id]">) {
  const user = await requireUser();
  const { id } = await props.params;
  const now = new Date();

  const rows = await db
    .select({
      id: bookings.id,
      leadId: bookings.leadId,
      title: bookings.title,
      startAt: bookings.startAt,
      meetingLink: bookings.meetingLink,
      googleEventId: bookings.googleEventId,
      company: leads.companyName,
    })
    .from(bookings)
    .innerJoin(campaignLeads, eq(campaignLeads.leadId, bookings.leadId))
    .innerJoin(leads, eq(leads.id, bookings.leadId))
    .where(
      and(
        eq(campaignLeads.campaignId, id),
        eq(bookings.userId, user.id),
        eq(bookings.status, "scheduled"),
        gte(bookings.startAt, now),
      ),
    )
    .orderBy(asc(bookings.startAt));

  return (
    <div className="space-y-3 p-4 md:p-6">
      {rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed py-16 text-center">
          <CalendarClock className="size-8 text-muted-foreground" />
          <div className="text-sm text-muted-foreground">No upcoming meetings for this campaign.</div>
          <Button asChild variant="outline" size="sm">
            <Link href={`/dial?campaign=${id}`}>Start dialing</Link>
          </Button>
        </div>
      ) : (
        rows.map((b) => (
          <Card key={b.id}>
            <CardContent className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
              <Link href={`/leads/${b.leadId}`} className="min-w-0 hover:underline">
                <div className="truncate text-sm font-medium">{b.title}</div>
                <div className="text-xs text-muted-foreground">
                  {b.company ? `${b.company} · ` : ""}
                  {format(b.startAt, "EEE MMM d, p")}
                </div>
              </Link>
              <div className="flex shrink-0 items-center gap-2">
                <Badge variant="outline">{b.googleEventId ? "Google Calendar" : "Local"}</Badge>
                {b.meetingLink && (
                  <Button asChild variant="ghost" size="icon" className="size-9">
                    <a href={b.meetingLink} target="_blank" rel="noreferrer">
                      <ExternalLink className="size-4" />
                    </a>
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}
