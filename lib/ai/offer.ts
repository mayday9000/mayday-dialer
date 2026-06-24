/**
 * Offer strengthener for the campaign builder. Takes the campaign brief + the
 * current offer and returns a few sharper variants — concrete outcome, more
 * specificity, and risk-reversal where it fits. Quality matters and this runs
 * once per campaign, so we use the larger Sonnet model.
 *
 * Never invents fake facts, brands, or numbers: it sharpens the framing of the
 * offer the user already wrote, it does not fabricate claims.
 */
import { claudeText, parseJsonLoose, CLAUDE_MODELS, isAnthropicConfigured } from "./client";
import { type CampaignBrief } from "@/lib/db/schema";

export type OfferVariant = { offer: string; rationale: string };

const SYSTEM = `You are a B2B cold-call offer strategist. Given a campaign brief and the current offer, rewrite it into 2-3 SHARPER variants that a salesperson can say on a call.

What makes an offer stronger:
- Concrete outcome: name the result the prospect gets (saved money, more covers, less churn), not vague "value".
- Specificity: be precise about who/what/how — tailored to the vertical, ICP, and persona.
- Risk-reversal where it fits naturally: a no-risk way to say yes (free trial, no setup fee, cancel anytime, pay-only-if-it-works). Only add it if it's believable; do not promise things not implied by the brief.

Rules:
- Each "offer" is 1-2 sentences, spoken-language, ready to say on a call.
- Each "rationale" is ONE short line on WHY the variant is stronger than the original.
- NEVER invent fake facts, brands, product names, guarantees, or statistics. Sharpen the framing of the offer provided; do not fabricate claims.
- Stay grounded in the brief. Do not drift to a different product or vertical.`;

/** Returns 2-3 sharper offer variants, or null if AI is off / nothing usable. */
export async function strengthenOffer(input: {
  brief: CampaignBrief;
  currentOffer: string;
}): Promise<OfferVariant[] | null> {
  if (!isAnthropicConfigured()) return null;

  const { brief, currentOffer } = input;

  const context = {
    vertical: brief.vertical,
    icp: brief.icp,
    goal: brief.goal,
    persona: brief.persona ?? undefined,
  };

  const prompt = `Campaign brief (JSON):
${JSON.stringify(context, null, 2)}

Current offer:
"""
${currentOffer}
"""

Return ONLY a JSON array of 2-3 objects, nothing else:
[{"offer": string, "rationale": string}]`;

  const out = await claudeText({
    model: CLAUDE_MODELS.sonnet,
    system: SYSTEM,
    prompt,
    maxTokens: 900,
  });
  const parsed = parseJsonLoose<unknown[]>(out);
  if (!Array.isArray(parsed)) return null;

  const variants = parsed
    .filter(
      (v): v is OfferVariant =>
        !!v &&
        typeof v === "object" &&
        typeof (v as OfferVariant).offer === "string" &&
        typeof (v as OfferVariant).rationale === "string",
    )
    .map((v) => ({ offer: v.offer.trim(), rationale: v.rationale.trim() }))
    .filter((v) => v.offer && v.rationale)
    .slice(0, 3);

  return variants.length ? variants : null;
}
