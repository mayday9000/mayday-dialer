/**
 * Extracts the primary decision-maker (owner / principal / broker-in-charge)
 * from a property-management company's own website text, using Claude Haiku.
 * Uses ONLY names explicitly present in the text — never guesses — so a missing
 * name stays missing rather than fabricated.
 */
import { claudeText, parseJsonLoose, CLAUDE_MODELS, isAnthropicConfigured } from "./client";

export type ExtractedContact = { name: string | null; title: string | null; email: string | null };

const SYSTEM = `You extract the primary DECISION-MAKER from a property-management company's own website text. That's the person to ask for on a cold call: owner, principal, president, founder, managing partner, or broker-in-charge.

Rules:
- Use ONLY names explicitly written in the text. NEVER invent, infer, or guess a name.
- If several owners/principals are listed, pick the most senior or first-listed.
- Prefer an owner/principal over a generic "property manager" or leasing agent.
- If no specific person is clearly named, return name: null.
- Return strict JSON only.`;

export async function extractDecisionMaker(
  websiteText: string,
  companyName: string,
): Promise<ExtractedContact | null> {
  if (!isAnthropicConfigured()) return null;
  const text = websiteText.trim();
  if (!text) return null;

  const prompt = `Company: ${companyName}

Website text:
"""
${text.slice(0, 9000)}
"""

Return ONLY JSON: {"name": string|null, "title": string|null, "email": string|null}
name = the decision-maker's full name if explicitly stated, else null.`;

  const out = await claudeText({
    model: CLAUDE_MODELS.haiku,
    system: SYSTEM,
    prompt,
    maxTokens: 200,
  });
  const parsed = parseJsonLoose<ExtractedContact>(out);
  if (!parsed || typeof parsed !== "object") return null;

  const name = typeof parsed.name === "string" && parsed.name.trim() ? parsed.name.trim() : null;
  if (!name) return null;
  return {
    name,
    title: typeof parsed.title === "string" && parsed.title.trim() ? parsed.title.trim() : null,
    email: typeof parsed.email === "string" && parsed.email.trim() ? parsed.email.trim() : null,
  };
}
