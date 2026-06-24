import { Badge } from "@/components/ui/badge";
import { ShieldCheck, ExternalLink } from "lucide-react";
import type { EnrichedField } from "@/lib/db/schema";

/**
 * Renders one enrichment field with provenance. Verified (≥2 sources or an
 * authoritative source) shows a green check; otherwise the value is shown but
 * labeled "via <source>" so it's never mistaken for confirmed fact. A missing
 * field renders "Unknown / unverified".
 */
export function EnrichmentField({
  label,
  field,
}: {
  label: string;
  field?: EnrichedField | null;
}) {
  if (!field?.value) {
    return (
      <div className="border-b pb-1.5">
        <dt className="text-xs text-muted-foreground">{label}</dt>
        <dd className="text-sm text-muted-foreground">Unknown / unverified</dd>
      </div>
    );
  }

  const sourceNames = [...new Set(field.sources.map((s) => s.name))];
  const url = field.sources.find((s) => s.url)?.url ?? null;

  return (
    <div className="border-b pb-1.5">
      <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {label}
        {field.verified ? (
          <Badge className="gap-1 bg-green-100 text-green-800 dark:bg-green-950/50 dark:text-green-300">
            <ShieldCheck className="size-3" />
            Verified
          </Badge>
        ) : (
          <span className="text-[10px] uppercase tracking-wide">via {sourceNames.join(", ")}</span>
        )}
      </dt>
      <dd className="flex items-start gap-1 text-sm">
        <span className="min-w-0 break-words">{field.value}</span>
        {url && (
          <a href={url} target="_blank" rel="noreferrer" className="mt-0.5 shrink-0 text-muted-foreground hover:text-foreground">
            <ExternalLink className="size-3" />
          </a>
        )}
      </dd>
    </div>
  );
}
