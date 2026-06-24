/**
 * Shared Anthropic client + a single-shot text helper. Used by the harvest
 * classifier (NL rules + ambiguous pruning) and the Key Notes generator.
 *
 * Every caller must tolerate a null return: no ANTHROPIC_API_KEY, or any API
 * error, yields null so features degrade gracefully instead of throwing.
 */
import Anthropic from "@anthropic-ai/sdk";

export const CLAUDE_MODELS = {
  haiku: "claude-haiku-4-5-20251001",
  sonnet: "claude-sonnet-4-6",
} as const;

let _client: Anthropic | null = null;

export function isAnthropicConfigured(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

function getClient(): Anthropic | null {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  if (!_client) _client = new Anthropic({ apiKey });
  return _client;
}

/** One prompt in, text out. Returns null on missing key or any error. */
export async function claudeText(opts: {
  prompt: string;
  system?: string;
  model?: string;
  maxTokens?: number;
}): Promise<string | null> {
  const client = getClient();
  if (!client) return null;
  try {
    const res = await client.messages.create({
      model: opts.model ?? CLAUDE_MODELS.haiku,
      max_tokens: opts.maxTokens ?? 1024,
      ...(opts.system ? { system: opts.system } : {}),
      messages: [{ role: "user", content: opts.prompt }],
    });
    const text = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
    return text || null;
  } catch {
    return null;
  }
}

/** Best-effort JSON parse of a model response (tolerates ```json fences). */
export function parseJsonLoose<T>(text: string | null): T | null {
  if (!text) return null;
  const cleaned = text
    .replace(/^\s*```(?:json)?/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    // Try to salvage the first {...} or [...] block.
    const match = cleaned.match(/[[{][\s\S]*[\]}]/);
    if (match) {
      try {
        return JSON.parse(match[0]) as T;
      } catch {
        return null;
      }
    }
    return null;
  }
}
