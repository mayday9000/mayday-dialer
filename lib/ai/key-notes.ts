/**
 * Generates the "Key Notes" shown on the dial cockpit — the few must-know
 * things a caller needs before dialing (who they'll talk to, what the firm is,
 * a concrete hook). Synthesized by Claude from whatever real data we have;
 * never invents facts.
 */
import { claudeText, parseJsonLoose, CLAUDE_MODELS, isAnthropicConfigured } from "./client";
import type { LeadEnrichment, LeadReview } from "../db/schema";

export type KeyNotesContext = {
  companyName: string | null;
  contactName: string | null;
  title: string | null;
  website: string | null;
  city: string | null;
  customFields: Record<string, string>;
  enrichment?: LeadEnrichment | null;
  notes: string[]; // existing note/system event bodies
  websiteText?: string | null; // optional scraped page text
  vertical?: string | null; // campaign vertical (any industry)
  offer?: string | null; // campaign offer, to angle the hooks
  reviews?: LeadReview[] | null; // verbatim customer reviews — mined for pain points/ammo
};

const SYSTEM = `You are prepping a salesperson before a cold call (any industry). From the provided facts, surface the few MUST-KNOW things that help them connect and tailor the pitch: who they'll talk to (name, role, background), what the business is (size, focus, what makes them tick), and any concrete hook (tools they use, recent news, memberships/affiliations). If a campaign vertical/offer is given, angle the hooks toward that offer.

When customer reviews are provided, mine them hard — they are the best ammo:
- Surface recurring PAIN POINTS reviewers complain about (slow responses, billing surprises, poor communication, high turnover) — especially ones the campaign offer could solve. Attribute to reviews: "Reviewers complain about X".
- Surface standout STRENGTHS or specifics (named staff praised, services highlighted) the rep can open with as rapport.
- Quote a short telling phrase only if it sharpens the point; don't dump whole reviews.

Rules:
- Output 2 to 4 bullets, highest-signal first. Fewer is better than padding.
- Be specific and concrete — names, numbers, tools, brand lines, review themes. No generic filler like "they value good service."
- NEVER invent or infer facts. Use ONLY what is provided. If the decision-maker is unknown, do not guess a name. Don't generalize one review into "customers" — say "a reviewer".
- Each bullet is one short line, <= 22 words, no trailing period.`;

/** Returns the bullets, or null if AI is unavailable / produced nothing usable. */
export async function generateKeyNotes(ctx: KeyNotesContext): Promise<string[] | null> {
  if (!isAnthropicConfigured()) return null;

  // Flatten enrichment to plain values for the prompt (drop provenance noise).
  const enrichmentFlat: Record<string, string> = {};
  for (const [k, v] of Object.entries(ctx.enrichment ?? {})) {
    if (v && typeof v.value === "string") enrichmentFlat[k] = v.value;
  }

  // Trim reviews for the prompt: cap count + length, keep rating/recency signal.
  const reviews = (ctx.reviews ?? [])
    .filter((r) => r.text)
    .slice(0, 6)
    .map((r) => ({
      rating: r.rating ?? undefined,
      when: r.relativeTime ?? undefined,
      text: r.text.slice(0, 400),
    }));

  const facts = {
    campaignVertical: ctx.vertical || undefined,
    campaignOffer: ctx.offer || undefined,
    company: ctx.companyName,
    contact: ctx.contactName,
    contactTitle: ctx.title,
    website: ctx.website,
    city: ctx.city,
    details: ctx.customFields,
    enrichment: enrichmentFlat,
    notes: ctx.notes.filter(Boolean),
    customerReviews: reviews.length ? reviews : undefined,
    websiteExcerpt: ctx.websiteText ? ctx.websiteText.slice(0, 4000) : undefined,
  };

  const prompt = `Facts about the lead (JSON):
${JSON.stringify(facts, null, 2)}

Return ONLY a JSON array of 2-4 short strings (the bullets), nothing else.`;

  const out = await claudeText({
    model: CLAUDE_MODELS.haiku,
    system: SYSTEM,
    prompt,
    maxTokens: 700,
  });
  const parsed = parseJsonLoose<unknown[]>(out);
  if (!Array.isArray(parsed)) return null;
  const bullets = parsed
    .filter((s): s is string => typeof s === "string")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 4);
  return bullets.length ? bullets : null;
}
