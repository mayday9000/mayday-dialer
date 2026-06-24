/**
 * Campaign architect — turns a one-line idea ("restaurants in the Philly metro,
 * sell online ordering, book demos") into a structured CampaignBrief that drives
 * the whole builder: ICP, geography, goal, a first-draft offer, persona,
 * qualifiers/disqualifiers, scraper keywords, and suggested local area codes.
 *
 * Uses Sonnet (this runs once per campaign and quality matters). Returns null
 * if AI is unavailable so the builder can fall back to manual fields.
 */
import { claudeText, parseJsonLoose, CLAUDE_MODELS, isAnthropicConfigured } from "./client";
import type { CampaignBrief, CampaignGoalType } from "../db/schema";

const SYSTEM = `You are a B2B cold-calling strategist. Turn the user's short campaign idea into a concrete, ready-to-run brief for an outbound calling campaign. Be specific and realistic — this drives a real lead scraper, script, and dialer.

Rules:
- Infer a tight ICP (who exactly we call) from the idea. Prefer the reachable, decision-able segment (independent operators / SMBs over giant chains) unless told otherwise.
- geography: keep the user's area; in extraAreas suggest 3-8 real surrounding towns/submarkets that expand reach. radiusMiles: a sensible drive-time radius.
- goal: the concrete call objective. goalType: one of meeting|sale|qualify|survey.
- offer: a first-draft value proposition (one or two sentences) — concrete outcome, not fluff. It can be improved later.
- persona: the role to ask for (e.g., "owner or general manager").
- qualifiers: 2-5 signals that a lead is a GOOD fit. disqualifiers: 2-5 signals to SKIP (chains/franchises/wrong segment/etc.).
- keywords: the primary search term a maps/places search would use to find these businesses.
- areaCodes: 1-3 real local area codes for the geography (for a local caller-ID number).
- tone: a short voice descriptor for the script.
- Use ONLY plausible, real-world specifics. Don't invent fake brand names.`;

export type ArchitectInput = {
  prompt: string;
  goalType?: CampaignGoalType; // optional hint from the goal chip
};

export async function draftCampaignBrief(input: ArchitectInput): Promise<CampaignBrief | null> {
  if (!isAnthropicConfigured()) return null;
  const idea = input.prompt.trim();
  if (idea.length < 3) return null;

  const prompt = `Campaign idea: "${idea}"${input.goalType ? `\nGoal type hint: ${input.goalType}` : ""}

Return ONLY this JSON object:
{
  "name": string,                 // short campaign name
  "vertical": string,
  "icp": string,
  "geography": string,
  "extraAreas": string[],
  "radiusMiles": number,
  "goal": string,
  "goalType": "meeting"|"sale"|"qualify"|"survey",
  "offer": string,
  "persona": string,
  "qualifiers": string[],
  "disqualifiers": string[],
  "tone": string,
  "areaCodes": string[],
  "keywords": string
}`;

  const out = await claudeText({
    model: CLAUDE_MODELS.sonnet,
    system: SYSTEM,
    prompt,
    maxTokens: 1200,
  });
  const parsed = parseJsonLoose<Record<string, unknown>>(out);
  if (!parsed || typeof parsed.vertical !== "string" || typeof parsed.offer !== "string") return null;

  const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
  const arr = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").map((x) => x.trim()).filter(Boolean) : [];
  const goalType =
    parsed.goalType === "meeting" || parsed.goalType === "sale" || parsed.goalType === "qualify" || parsed.goalType === "survey"
      ? parsed.goalType
      : input.goalType;

  const brief: CampaignBrief = {
    vertical: str(parsed.vertical),
    icp: str(parsed.icp),
    geography: str(parsed.geography),
    extraAreas: arr(parsed.extraAreas).slice(0, 8),
    radiusMiles: typeof parsed.radiusMiles === "number" ? parsed.radiusMiles : undefined,
    goal: str(parsed.goal),
    goalType,
    offer: str(parsed.offer),
    persona: str(parsed.persona) || undefined,
    qualifiers: arr(parsed.qualifiers).slice(0, 6),
    disqualifiers: arr(parsed.disqualifiers).slice(0, 6),
    tone: str(parsed.tone) || undefined,
    areaCodes: arr(parsed.areaCodes).slice(0, 3),
    keywords: str(parsed.keywords) || undefined,
  };
  // Stash a suggested name on the side for the builder (not part of the brief type).
  (brief as CampaignBrief & { name?: string }).name = str(parsed.name) || brief.vertical;
  return brief;
}
