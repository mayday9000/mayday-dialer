/** Env-driven config for the harvester. Read once, here, so callers don't. */
export const harvestConfig = {
  // Google Places API (New) — best data (website + hours + phone), super cheap.
  // Optional: when unset we fall back to free OpenStreetMap.
  googlePlacesApiKey: process.env.GOOGLE_PLACES_API_KEY || null,
  // The Haiku classifier (NL rules + ambiguous pruning) only runs when both are
  // set. Off => the ambiguous middle falls back to the human review queue.
  llmEnabled: process.env.HARVEST_LLM_ENABLED === "true",
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || null,
  // Per-invocation safety caps (Vercel function timeouts).
  defaultMaxPerRun: 30,
  scrapeConcurrency: 4,
};

export function isPlacesConfigured(): boolean {
  return !!harvestConfig.googlePlacesApiKey;
}

export function isLlmConfigured(): boolean {
  return harvestConfig.llmEnabled && !!harvestConfig.anthropicApiKey;
}
