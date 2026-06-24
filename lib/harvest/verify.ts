/**
 * Computes the verified flag for each enrichment field. A value is "verified"
 * only when corroborated by >=2 independent sources, or when it came from an
 * authoritative source. Everything else stays unverified and the UI renders it
 * as "Unknown / unverified" — we never assert data we can't stand behind.
 */
import type { LeadEnrichment } from "../db/schema";

const AUTHORITATIVE = new Set(["nc_rec"]);

export function verifyEnrichment(e: LeadEnrichment): LeadEnrichment {
  for (const key of Object.keys(e) as (keyof LeadEnrichment)[]) {
    const f = e[key];
    if (!f) continue;
    const names = new Set(f.sources.map((s) => s.name));
    const verified = names.size >= 2 || [...names].some((n) => AUTHORITATIVE.has(n));
    f.verified = verified;
    f.confidence = verified ? 0.9 : f.sources.length ? 0.45 : 0;
  }
  return e;
}
