"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EnrichmentField } from "@/components/enrichment-field";
import type { LeadEnrichment } from "@/lib/db/schema";
import { approveCandidate, rejectCandidate } from "./actions";
import { Check, X, Globe, ExternalLink, MapPin, Lightbulb } from "lucide-react";

export type Candidate = {
  id: string;
  companyName: string | null;
  phoneDisplay: string;
  website: string | null;
  city: string | null;
  categories: string | null;
  sourceUrl: string | null;
  reason: string | null;
  enrichment: LeadEnrichment;
  keyNotes: string[];
};

function withProtocol(url: string) {
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

export function ReviewClient({ initialItems }: { initialItems: Candidate[] }) {
  const [items, setItems] = useState(initialItems);
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);

  function act(id: string, kind: "approve" | "reject") {
    setBusyId(id);
    startTransition(async () => {
      const res = kind === "approve" ? await approveCandidate(id) : await rejectCandidate(id);
      if (res.ok) {
        setItems((prev) => prev.filter((i) => i.id !== id));
        toast.success(kind === "approve" ? "Approved — now dialable" : "Rejected & archived");
      } else {
        toast.error(res.error);
      }
      setBusyId(null);
    });
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">{items.length} to review</p>
      {items.map((c) => {
        const enr = c.enrichment ?? {};
        const hasEnr = Object.keys(enr).length > 0;
        return (
          <Card key={c.id}>
            <CardContent className="space-y-3 py-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-medium">{c.companyName || "—"}</div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
                    <span className="tabular-nums">{c.phoneDisplay || "no phone"}</span>
                    {c.city && (
                      <span className="flex items-center gap-1">
                        <MapPin className="size-3" />
                        {c.city}
                      </span>
                    )}
                    {c.categories && <span>{c.categories}</span>}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    className="bg-green-600 hover:bg-green-600/90"
                    onClick={() => act(c.id, "approve")}
                    disabled={pending && busyId === c.id}
                  >
                    <Check className="size-4" />
                    Approve
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-muted-foreground hover:text-destructive"
                    onClick={() => act(c.id, "reject")}
                    disabled={pending && busyId === c.id}
                  >
                    <X className="size-4" />
                    Reject
                  </Button>
                </div>
              </div>

              {c.reason && (
                <div className="rounded-md bg-muted/50 px-3 py-1.5 text-xs text-muted-foreground">
                  {c.reason}
                </div>
              )}

              {(c.website || c.sourceUrl) && (
                <div className="flex flex-wrap items-center gap-4 text-sm">
                  {c.website && (
                    <a
                      href={withProtocol(c.website)}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 text-primary hover:underline"
                    >
                      <Globe className="size-3.5" />
                      {c.website}
                      <ExternalLink className="size-3" />
                    </a>
                  )}
                  {c.sourceUrl && (
                    <a
                      href={c.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground"
                    >
                      source
                      <ExternalLink className="size-3" />
                    </a>
                  )}
                </div>
              )}

              {c.keyNotes.length > 0 && (
                <div className="rounded-md border border-l-4 border-l-indigo-500 bg-indigo-50/60 px-3 py-2 dark:bg-indigo-950/30">
                  <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-indigo-700 dark:text-indigo-300">
                    <Lightbulb className="size-3.5" />
                    Key Notes
                  </div>
                  <ul className="list-disc space-y-0.5 pl-4 text-sm">
                    {c.keyNotes.slice(0, 4).map((n, i) => (
                      <li key={i}>{n}</li>
                    ))}
                  </ul>
                </div>
              )}

              {hasEnr && (
                <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
                  <EnrichmentField label="Office hours" field={enr.officeHours} />
                  <EnrichmentField label="Email" field={enr.email} />
                  <EnrichmentField label="Rating" field={enr.rating} />
                  <EnrichmentField label="Social" field={enr.social} />
                </dl>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
