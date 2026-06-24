/**
 * Cold-call script generator for the campaign builder. From the campaign brief
 * + the (strengthened) offer, Claude writes a tight, simplified markdown script
 * the rep reads on the dial cockpit. Quality matters and this runs once per
 * campaign, so we use the larger Sonnet model.
 *
 * The script uses the dialer's token placeholders so it personalizes per lead
 * (see lib/script-personalize.ts): [first name], [DM name], [company], [city],
 * [number]. Never invents fake facts, brands, or numbers.
 */
import { claudeText, CLAUDE_MODELS, isAnthropicConfigured } from "./client";
import { type CampaignBrief } from "@/lib/db/schema";

const SYSTEM = `You write SHORT, tight cold-call scripts for a B2B salesperson, output as Markdown. The rep reads the script live while dialing, so it must be simple and skimmable — NOT a bloated wall of text.

Output REQUIRED sections, in THIS order, each as a Markdown heading (## ...):
1. ## Opener — quick, human intro that earns 10 more seconds.
2. ## Value hook — one or two lines built on THE OFFER. State the concrete outcome.
3. ## Qualifying questions — 2-3 short questions (a bullet list).
4. ## Objection handling — exactly 3 objections that are common for THIS vertical/offer, each as "**Objection:** ... — *Response:* ..." on its own line.
5. ## The ask — the close, tied to the campaign goal (e.g. book the meeting).
6. ## Voicemail — a short 15-20 second message to leave if no answer.

Personalization tokens — use these EXACT bracket tokens so the dialer fills them per lead:
- [first name] — the contact's first name
- [DM name] — the decision-maker's full name (use when asking for someone)
- [company] — the company name
- [city] — the lead's city
- [number] — the rep's callback number (use in the voicemail)
Do not invent other tokens. Do not write the rep's own name as a token — leave a plain blank like "[your name]" only in the opener/voicemail if needed.

Rules:
- Keep it SIMPLE and tight. Short sentences, spoken language. No stage directions beyond what's needed.
- NEVER invent fake facts, brands, product names, guarantees, or statistics. Build only on the offer and brief provided.
- Output ONLY the markdown script. No preamble, no closing commentary, no code fences.`;

/** Generate a markdown cold-call script. Returns null if AI is off / unusable. */
export async function generateScript(input: {
  brief: CampaignBrief;
  offer: string;
  styleSample?: string | null;
}): Promise<string | null> {
  if (!isAnthropicConfigured()) return null;

  const { brief, offer, styleSample } = input;

  const context = {
    vertical: brief.vertical,
    icp: brief.icp,
    geography: brief.geography,
    goal: brief.goal,
    goalType: brief.goalType ?? undefined,
    persona: brief.persona ?? undefined,
    tone: brief.tone ?? undefined,
  };

  const styleBlock =
    styleSample && styleSample.trim()
      ? `\nHouse-style sample — an existing script for this account. MATCH its structure, voice, and formatting (headings, list style, length) as closely as you can while covering the required sections:
"""
${styleSample.trim().slice(0, 6000)}
"""\n`
      : "";

  const voice = brief.tone?.trim()
    ? `Voice/tone for the script: ${brief.tone.trim()}.`
    : "Voice/tone: friendly and direct.";

  const prompt = `Campaign brief (JSON):
${JSON.stringify(context, null, 2)}

The offer to pitch (use it in the Value hook):
"""
${offer.trim()}
"""

${voice}
${styleBlock}
Write the cold-call script now as Markdown, with all required sections in order.`;

  const out = await claudeText({
    model: CLAUDE_MODELS.sonnet,
    system: SYSTEM,
    prompt,
    maxTokens: 1500,
  });
  if (!out) return null;

  // Strip any stray code fences and confirm we actually got a script back.
  const md = out
    .replace(/^\s*```(?:markdown|md)?/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  return md.length ? md : null;
}
