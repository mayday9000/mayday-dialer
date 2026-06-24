/**
 * Fuzzy name+address matching — the dedup fallback for candidates that have no
 * phone (or share a building's phone), where the `leads.phoneNormalized` unique
 * index can't catch a duplicate. Kept conservative (high threshold) so we never
 * wrongly merge two distinct firms; every fuzzy match is logged so it's
 * auditable and reversible.
 */

const NOISE =
  /\b(llc|inc|co|corp|ltd|the|and|of|group|properties|property|management|mgmt|realty|real|estate|services|services?|company|holdings|partners|associates|pm)\b/g;

/** Lowercase, strip legal/industry boilerplate + punctuation, collapse space. */
export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(NOISE, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Shared hosts that are NOT a business's own domain — we must never merge two
// unrelated firms just because they both link to Facebook / a site builder.
const GENERIC_HOSTS = new Set([
  "facebook.com", "instagram.com", "twitter.com", "x.com", "linkedin.com", "youtube.com",
  "tiktok.com", "yelp.com", "google.com", "goo.gl", "business.site", "linktr.ee",
  "wixsite.com", "wix.com", "squarespace.com", "wordpress.com", "blogspot.com",
  "godaddysites.com", "weebly.com", "yola.com", "tumblr.com", "site123.me", "webnode.com",
]);

/**
 * Registrable-ish domain for website dedup: strip protocol/www/path and keep the
 * last two labels ("https://www.ExamplePM.com/about" -> "examplepm.com").
 * Returns null for blanks and generic/shared hosts (social + site builders), so
 * two different firms are never merged on a shared platform link.
 */
export function normalizeDomain(url: string | null | undefined): string | null {
  if (!url) return null;
  let host: string;
  try {
    host = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname.toLowerCase();
  } catch {
    return null;
  }
  host = host.replace(/^www\./, "");
  const labels = host.split(".").filter(Boolean);
  if (labels.length < 2) return null;
  const domain = labels.slice(-2).join(".");
  return GENERIC_HOSTS.has(domain) ? null : domain;
}

/** "1234 Main St, Suite 5" -> "1234 main" (street number + first street word). */
export function streetKey(address: string | null | undefined): string | null {
  if (!address) return null;
  const m = address.toLowerCase().match(/^\s*(\d+)\s+([a-z0-9]+)/);
  if (!m) return null;
  return `${m[1]} ${m[2]}`;
}

/** Jaccard token-set similarity in [0,1]. */
export function tokenSetSimilarity(a: string, b: string): number {
  const sa = new Set(a.split(" ").filter(Boolean));
  const sb = new Set(b.split(" ").filter(Boolean));
  if (!sa.size || !sb.size) return 0;
  let inter = 0;
  for (const t of sa) if (sb.has(t)) inter++;
  const union = new Set([...sa, ...sb]).size;
  return inter / union;
}

export const FUZZY_THRESHOLD = 0.85;

export type FuzzyTarget = {
  id: string;
  companyName: string | null;
  city: string | null;
  address: string | null;
};

/**
 * Returns the id of an existing lead that is (conservatively) the same business
 * as `candidate`, or null. A same-street address match relaxes the name
 * threshold slightly; otherwise names alone must clear FUZZY_THRESHOLD.
 */
export function findFuzzyMatch(
  candidate: { companyName: string; city: string | null; address: string | null },
  existing: FuzzyTarget[],
): string | null {
  const cName = normalizeName(candidate.companyName);
  if (!cName) return null;
  const cTokens = cName.split(" ").filter(Boolean);
  const cCity = (candidate.city ?? "").toLowerCase().trim();
  const cStreet = streetKey(candidate.address);

  let best: { id: string; score: number } | null = null;
  for (const e of existing) {
    if (!e.companyName) continue;
    // Only compare within the same city to avoid cross-market false merges.
    if (cCity && e.city && e.city.toLowerCase().trim() !== cCity) continue;

    const score = tokenSetSimilarity(cName, normalizeName(e.companyName));
    const sameStreet = cStreet && streetKey(e.address) === cStreet;
    // A single-token name (e.g. just "abc" once industry words are stripped) is
    // too generic to merge on its own — require a same-street confirmation.
    if (cTokens.length < 2 && !sameStreet) continue;
    const threshold = sameStreet ? FUZZY_THRESHOLD - 0.1 : FUZZY_THRESHOLD;
    if (score >= threshold && (!best || score > best.score)) {
      best = { id: e.id, score };
    }
  }
  return best?.id ?? null;
}
