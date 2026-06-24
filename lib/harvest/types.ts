/**
 * Shared types for the lead-harvesting pipeline. Framework-free so they can be
 * imported by server actions, the cron route, and the `pnpm leads:harvest`
 * script alike.
 */
import type {
  LeadEnrichment,
  LeadReview,
  harvestSearches,
  HarvestTrigger,
  HarvestCursor,
  DayPeriod,
} from "../db/schema";

export type HarvestSearch = typeof harvestSearches.$inferSelect;

/** A raw business discovered by a source, before dedup/classify/enrich. */
export type Candidate = {
  companyName: string;
  phoneRaw: string | null;
  website: string | null;
  hoursText: string | null; // source-provided office hours, if any (Places/OSM)
  periods: DayPeriod[] | null; // structured weekly hours for open-now (Places)
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  categories: string[]; // provider category aliases / OSM tags
  rating: number | null;
  reviewCount: number | null;
  reviews: LeadReview[]; // verbatim customer-review snippets (Places only)
  // Where this candidate was discovered (for provenance + attribution).
  source: { name: string; url: string | null };
};

export type Verdict = "approve" | "reject" | "review";

/** A candidate after classification (rules and/or LLM). */
export type Classified = Candidate & {
  verdict: Verdict;
  reason: string;
  confidence: number; // 0..1
};

/** A classified candidate after enrichment (Step 4 fills `enrichment`). */
export type Enriched = Classified & {
  enrichment: LeadEnrichment;
  // Transient (not stored): condensed website text, for Key Notes generation.
  websiteText?: string | null;
};

/** Output of the discovery layer for one run. */
export type DiscoverResult = {
  candidates: Candidate[];
  errors: string[];
  sourceName: string;
  nextCursor: HarvestCursor;
};

export type RunOptions = {
  trigger: HarvestTrigger;
  maxBusinesses?: number; // overrides search.maxPerRun for this invocation
  createdBy?: string | null;
};
