import Link from "next/link";
import { eq, desc, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { leads, leadEvents } from "@/lib/db/schema";
import { requireAdmin } from "@/lib/auth-server";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { formatPhone } from "@/lib/phone";
import { ReviewClient, type Candidate } from "./review-client";

export default async function ReviewPage() {
  await requireAdmin();

  const pending = await db
    .select()
    .from(leads)
    .where(eq(leads.reviewState, "pending"))
    .orderBy(desc(leads.createdAt))
    .limit(100);

  // Latest event body per lead = the classifier's reason.
  const ids = pending.map((l) => l.id);
  const reasons = new Map<string, string>();
  if (ids.length) {
    const evs = await db
      .select({ leadId: leadEvents.leadId, body: leadEvents.body })
      .from(leadEvents)
      .where(inArray(leadEvents.leadId, ids))
      .orderBy(desc(leadEvents.createdAt));
    for (const e of evs) if (e.body && !reasons.has(e.leadId)) reasons.set(e.leadId, e.body);
  }

  const items: Candidate[] = pending.map((l) => {
    const cf = (l.customFields as Record<string, string> | null) ?? {};
    return {
      id: l.id,
      companyName: l.companyName,
      phoneDisplay: formatPhone(l.phone),
      website: l.website,
      city: cf.City ?? null,
      categories: cf.Categories ?? null,
      sourceUrl: cf["Source URL"] ?? null,
      reason: reasons.get(l.id) ?? null,
      enrichment: l.enrichment ?? {},
      keyNotes: l.keyNotes ?? [],
    };
  });

  return (
    <div className="flex flex-col">
      <PageHeader
        title="Review queue"
        description="Harvested businesses the classifier wasn't sure about. Approve to dial, reject to archive."
      />
      <div className="p-6">
        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed py-16 text-center">
            <div className="text-sm text-muted-foreground">Nothing to review. 🎉</div>
            <Button asChild variant="outline" size="sm">
              <Link href="/admin/lead-sources">Back to lead sources</Link>
            </Button>
          </div>
        ) : (
          <ReviewClient initialItems={items} />
        )}
      </div>
    </div>
  );
}
