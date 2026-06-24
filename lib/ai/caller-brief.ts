/**
 * Caller brief — turns a campaign's structured brief (CampaignBrief) into a
 * scannable study sheet a rep can read before dialing and know exactly WHAT
 * they're selling and WHO they're selling to: the audience, the pains, the
 * offer, the objections they'll hit (with rebuttals), fit signals, and the ask.
 *
 * Uses Sonnet (quality matters; runs once per campaign on demand). Returns null
 * when AI is unavailable so the caller can fall back to the manual brief.
 */
import { claudeText, parseJsonLoose, CLAUDE_MODELS, isAnthropicConfigured } from "./client";
import type { CampaignBrief } from "../db/schema";

export type CallerBriefResult = {
  summary: string; // 1-2 sentence TL;DR: what we sell + to whom
  audience: string; // who we're calling — the human on the other end
  painPoints: string[]; // what's hurting in their world today
  offer: string; // what we're selling, in plain language
  benefits: string[]; // concrete outcomes / why it lands
  objections: { objection: string; response: string }[]; // pushback + rebuttal
  goodFit: string[]; // signals this is a great prospect
  skip: string[]; // signals to disqualify / not worth the time
  theAsk: string; // the single goal of the call
};

const SYSTEM = `You are a B2B cold-calling coach writing a one-page "study sheet" a rep reads before they start dialing a campaign. The rep should finish it knowing exactly what they're selling, who they're talking to, what that person is struggling with, and how to handle pushback.

Rules:
- Write for the REP, second person ("you"), plain and concrete. No fluff, no buzzwords.
- Ground everything in the campaign facts provided. Where facts are thin, infer realistic specifics for this vertical — never invent fake brand names, prices, or stats.
- painPoints: 3-5 real frustrations THIS audience feels day to day (the wedge the offer addresses).
- objections: the 4-6 objections this exact prospect actually raises, each with a short, confident rebuttal that moves toward the ask.
- benefits: tangible outcomes, not features.
- goodFit / skip: concrete, observable signals.
- theAsk: the one concrete goal of the call (e.g. "book a 20-minute call").
- Keep each bullet to one sentence.`;

export async function generateCallerBrief(input: {
  name: string;
  description?: string | null;
  industry?: string | null;
  location?: string | null;
  existingBrief?: string | null;
  brief?: CampaignBrief | null;
}): Promise<CallerBriefResult | null> {
  if (!isAnthropicConfigured()) return null;

  const b = input.brief;
  const context = [
    `Campaign: ${input.name}`,
    input.description ? `One-liner: ${input.description}` : "",
    input.industry ? `Industry: ${input.industry}` : "",
    input.location ? `Location: ${input.location}` : "",
    b?.vertical ? `Vertical: ${b.vertical}` : "",
    b?.icp ? `Ideal customer: ${b.icp}` : "",
    b?.geography ? `Geography: ${b.geography}` : "",
    b?.persona ? `Decision-maker to reach: ${b.persona}` : "",
    b?.goal ? `Call goal: ${b.goal}` : "",
    b?.offer ? `Offer / value prop: ${b.offer}` : "",
    b?.qualifiers?.length ? `Good-fit signals: ${b.qualifiers.join("; ")}` : "",
    b?.disqualifiers?.length ? `Skip signals: ${b.disqualifiers.join("; ")}` : "",
    b?.tone ? `Tone: ${b.tone}` : "",
    input.existingBrief ? `Existing notes (improve on these):\n${input.existingBrief}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const prompt = `Here is everything known about the campaign:

${context}

Return ONLY this JSON object:
{
  "summary": string,
  "audience": string,
  "painPoints": string[],
  "offer": string,
  "benefits": string[],
  "objections": [{ "objection": string, "response": string }],
  "goodFit": string[],
  "skip": string[],
  "theAsk": string
}`;

  const out = await claudeText({
    model: CLAUDE_MODELS.sonnet,
    system: SYSTEM,
    prompt,
    maxTokens: 2000,
  });
  const p = parseJsonLoose<Record<string, unknown>>(out);
  if (!p || typeof p.summary !== "string" || typeof p.offer !== "string") return null;

  const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
  const arr = (v: unknown): string[] =>
    Array.isArray(v)
      ? v.filter((x): x is string => typeof x === "string").map((x) => x.trim()).filter(Boolean)
      : [];
  const objections = Array.isArray(p.objections)
    ? p.objections
        .map((o) => {
          const obj = (o ?? {}) as Record<string, unknown>;
          return { objection: str(obj.objection), response: str(obj.response) };
        })
        .filter((o) => o.objection && o.response)
        .slice(0, 8)
    : [];

  return {
    summary: str(p.summary),
    audience: str(p.audience),
    painPoints: arr(p.painPoints).slice(0, 6),
    offer: str(p.offer),
    benefits: arr(p.benefits).slice(0, 6),
    objections,
    goodFit: arr(p.goodFit).slice(0, 6),
    skip: arr(p.skip).slice(0, 6),
    theAsk: str(p.theAsk),
  };
}

/** Render a caller brief into the markdown study sheet shown on the overview.
 *  Uses `##` sections so it reads cleanly (and the section browser can index it). */
export function callerBriefToMarkdown(r: CallerBriefResult): string {
  const bullets = (items: string[]) => items.map((i) => `- ${i}`).join("\n");
  const blocks: string[] = [];

  if (r.summary) blocks.push(`## TL;DR\n${r.summary}`);
  if (r.audience) blocks.push(`## Who you're calling\n${r.audience}`);
  if (r.painPoints.length) blocks.push(`## What they're dealing with\n${bullets(r.painPoints)}`);
  if (r.offer) blocks.push(`## What we're selling\n${r.offer}`);
  if (r.benefits.length) blocks.push(`## Why it lands\n${bullets(r.benefits)}`);
  if (r.objections.length) {
    blocks.push(
      `## Common objections\n${r.objections
        .map((o) => `**“${o.objection}”**\n\n${o.response}`)
        .join("\n\n")}`,
    );
  }
  if (r.goodFit.length) blocks.push(`## Good-fit signals\n${bullets(r.goodFit)}`);
  if (r.skip.length) blocks.push(`## Skip if\n${bullets(r.skip)}`);
  if (r.theAsk) blocks.push(`## The ask\n${r.theAsk}`);

  return blocks.join("\n\n");
}
