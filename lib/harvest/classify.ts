/**
 * Classifies a candidate as a fit for the campaign (`approve`), a non-fit to
 * auto-archive (`reject`), or an ambiguous case (`review`).
 *
 * Two passes: classifyByRules (hard filters + category/keyword signals, free,
 * runs first) and classifyReviewWithContext (Claude Haiku re-judges the
 * ambiguous middle AFTER the website is scraped, using real site content + the
 * search's vertical + NL customRules). The split is deliberate so the LLM never
 * decides on the business name alone.
 *
 * Vertical-aware: the curated category/keyword allow+reject lists below are
 * property-management-specific and apply ONLY when search.vertical is property
 * management. Any other vertical skips those signals (returns "review") and
 * lets the LLM pass judge fit from the search's vertical + customRules, so the
 * pipeline works for restaurants, dentists, etc. The PM path is preserved
 * exactly so existing PM campaigns are unaffected.
 */
import type { Candidate, Classified, Enriched, Verdict, HarvestSearch } from "./types";
import { isLlmConfigured } from "./config";
import { claudeText, parseJsonLoose, CLAUDE_MODELS } from "../ai/client";

// Categories across sources (OSM office tags + Google Places types). Real-estate
// agent categories are deliberately NEUTRAL (not rejected) — many PM firms are
// tagged that way — so name signals / Haiku decide.
const ALLOW_CATEGORIES = new Set(["property_management", "propertymgmt"]);
const REJECT_CATEGORIES = new Set([
  // Google Places (New) types
  "insurance_agency",
  "lawyer",
  "bank",
  "accounting",
  "finance",
  "moving_company",
  "general_contractor",
  "plumber",
  "electrician",
  "roofing_contractor",
  "storage",
  // OSM / generic
  "insurance",
  "lawyers",
  "bank_office",
  "accountant",
  "contractor",
]);

const POSITIVE =
  /(property management|propertymanagement|prop\.? ?mgmt|leasing|rental homes|hoa|community association|association management|narpm|doors under management)/i;
const NEGATIVE =
  /(realtor|real estate agent|home ?buy|we buy|sell your home|mortgage|home loan|insurance|attorney|law firm|title company|moving company|house cleaning|inspection)/i;

function decide(c: Candidate, verdict: Verdict, reason: string, confidence: number): Classified {
  return { ...c, verdict, reason, confidence };
}

/**
 * True when the search targets property management. The PM-specific category /
 * keyword allow+reject signals below apply ONLY in this case. Matching is
 * case/spacing-insensitive ("property_management", "property management",
 * "Property  Management" all count). An empty/undefined vertical is treated as
 * PM too, so legacy callers (and existing PM campaigns) keep today's
 * behavior exactly.
 */
function isPropertyManagement(search: HarvestSearch): boolean {
  const v = (search.vertical ?? "").trim().toLowerCase().replace(/[\s_-]+/g, " ").trim();
  return v === "" || v === "property management";
}

/** Pure, free, deterministic classification. No network. */
export function classifyByRules(c: Candidate, search: HarvestSearch): Classified {
  // 1) Hard filters known at discovery time — VERTICAL-AGNOSTIC, apply to every
  // vertical. requireWebsite is enforced AFTER enrichment (website discovery
  // runs there), not here.
  if (search.requirePhone && !c.phoneRaw) return decide(c, "reject", "No phone number", 0.95);
  if (search.minRating != null && c.rating != null && c.rating < search.minRating) {
    return decide(c, "reject", `Rating ${c.rating} below ${search.minRating}`, 0.85);
  }
  if (search.minReviews != null && c.reviewCount != null && c.reviewCount < search.minReviews) {
    return decide(c, "reject", `${c.reviewCount} reviews below ${search.minReviews}`, 0.85);
  }

  // 2) Category + name/keyword signals are PROPERTY-MANAGEMENT-SPECIFIC. For any
  // other vertical we have no curated category lists, so don't apply PM
  // approve/reject signals — hand the candidate to the LLM pass (Step 3) /
  // human queue as a neutral "review" and let real website content decide.
  if (!isPropertyManagement(search)) {
    return decide(c, "review", "Needs review — LLM pass decides fit", 0.4);
  }

  // 2b) PM allow/deny signals (unchanged).
  const cats = c.categories.map((x) => x.toLowerCase());
  const hasAllowCat = cats.some((x) => ALLOW_CATEGORIES.has(x));
  const rejectCats = cats.filter((x) => REJECT_CATEGORIES.has(x));
  const text = `${c.companyName} ${cats.join(" ")}`;
  const pos = POSITIVE.test(text);
  const neg = NEGATIVE.test(c.companyName);

  if (hasAllowCat && !neg) {
    return decide(c, "approve", "Property-management category", 0.9);
  }
  if (pos && rejectCats.length === 0 && !neg) {
    return decide(c, "approve", "Property-management signal in name/category", 0.8);
  }
  if (rejectCats.length > 0 && !hasAllowCat && !pos) {
    return decide(c, "reject", `Non-PM category (${rejectCats.join(", ")})`, 0.85);
  }
  if (neg && !pos && !hasAllowCat) {
    return decide(c, "reject", "Name signals non-PM (realtor/mortgage/etc.)", 0.75);
  }

  // 3) Ambiguous middle — Haiku (Step 3) or human review.
  return decide(c, "review", "Unclear from category/name — needs review", 0.4);
}

// The generic system prompt judges fit against the campaign's stated vertical +
// rules (passed per-call). Vertical-agnostic, so it works for restaurants,
// dentists, etc. — not just PM.
const CLASSIFIER_SYSTEM = `You qualify B2B cold-call leads for an outbound sales campaign. You are given the campaign's target vertical and any extra qualifying rules, then a single business's name, categories, location, and a scraped excerpt of its website.

Decide whether the business fits the campaign's target — i.e. it is a real, reachable business of the stated vertical that matches the campaign's ICP and qualifiers, and does not trip any disqualifier. Approve clear fits, reject clear non-fits (wrong industry, defunct, or explicitly disqualified). When genuinely unsure from the evidence, use "review".`;

// PM-equivalent guidance used when the search is property management and carries
// no customRules — preserves the original classifier's intent (sell back-office
// automation to firms that manage rental "doors", reject adjacent real-estate /
// finance / trades). Mirrors the legacy single-purpose prompt.
const PM_DEFAULT_GUIDANCE = `Campaign vertical: property management.
Target: firms that manage rental properties ("doors") on behalf of owners — we sell them back-office automation (leasing paperwork, tenant communications, owner reporting, maintenance triage).
Approve only if the business is, or clearly includes, a property-management operation we could sell to.
Reject general real-estate agents/brokers, mortgage lenders, insurance, law/title firms, builders/contractors, cleaning, moving, and self-managed single apartment complexes.`;

/**
 * Re-judge rules-flagged `review` candidates with Claude Haiku AFTER enrichment,
 * so the model decides on the real scraped website content (+ the search's NL
 * `customRules`) — not just the business name. One call per item (bounded
 * concurrency). Items with no website text, or any failure, stay `review` for
 * the human queue (never a silent approve).
 */
export async function classifyReviewWithContext(
  items: Enriched[],
  search: HarvestSearch,
): Promise<Enriched[]> {
  if (!isLlmConfigured()) return items;

  const rules = (search.customRules ?? "").trim();
  const verticalRaw = (search.vertical ?? "").trim();
  const isPm = isPropertyManagement(search);

  // Per-campaign guidance block prepended to every prompt. PM with no customRules
  // reuses the legacy guidance so its judgments are unchanged; other verticals
  // (and PM-with-rules) describe the target from the search's vertical +
  // customRules. Falls back to a generic "real business of the stated vertical"
  // brief when nothing useful is set.
  const guidanceLines: string[] = [];
  if (isPm && !rules) {
    guidanceLines.push(PM_DEFAULT_GUIDANCE);
  } else {
    if (verticalRaw) {
      guidanceLines.push(`Campaign vertical: ${verticalRaw}.`);
    } else if (isPm) {
      guidanceLines.push("Campaign vertical: property management.");
    }
    if (rules) {
      guidanceLines.push(`Extra rules from the user — follow strictly:\n${rules}`);
    }
    if (!guidanceLines.length) {
      guidanceLines.push(
        "No specific vertical or rules were provided. Approve any real, reachable, currently-operating business; reject defunct listings, placeholders, or pages with no sign of an active business.",
      );
    }
  }
  const guidance = guidanceLines.join("\n\n");

  const valid: Verdict[] = ["approve", "reject", "review"];
  const out = [...items];

  const targets = items
    .map((it, i) => ({ it, i }))
    .filter(({ it }) => it.verdict === "review" && !!it.websiteText);
  if (!targets.length) return out;

  let cursor = 0;
  async function worker() {
    while (cursor < targets.length) {
      const { it, i } = targets[cursor++];
      const prompt = `${guidance}\n\nBusiness: ${it.companyName}
Categories: ${it.categories.join(", ") || "n/a"}
Location: ${[it.city, it.state].filter(Boolean).join(", ") || "n/a"}

Website excerpt:
"""
${(it.websiteText ?? "").slice(0, 6000)}
"""

Decide if this business fits the campaign's target described above. Reply ONLY JSON: {"verdict":"approve|reject|review","reason":"<=14 words"}`;

      const res = await claudeText({
        model: CLAUDE_MODELS.haiku,
        system: CLASSIFIER_SYSTEM,
        prompt,
        maxTokens: 120,
      });
      const parsed = parseJsonLoose<{ verdict: string; reason?: string }>(res);
      if (parsed && valid.includes(parsed.verdict as Verdict)) {
        out[i] = {
          ...it,
          verdict: parsed.verdict as Verdict,
          reason: parsed.reason ? `AI: ${parsed.reason}` : it.reason,
          confidence: 0.75,
        };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(3, targets.length) }, worker));
  return out;
}
