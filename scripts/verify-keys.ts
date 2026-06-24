/**
 * Diagnostic: confirms ANTHROPIC_API_KEY + GOOGLE_PLACES_API_KEY are not just
 * present but actually valid, with tiny live calls. Prints status only — never
 * the key values. Run: pnpm exec dotenv -e .env -- tsx scripts/verify-keys.ts
 */
import { claudeText, isAnthropicConfigured } from "../lib/ai/client";
import { isPlacesConfigured } from "../lib/harvest/config";
import { placesSearch } from "../lib/harvest/sources/places";

async function main() {
  // Anthropic
  if (!isAnthropicConfigured()) {
    console.log("ANTHROPIC_API_KEY: not set");
  } else {
    const r = await claudeText({ prompt: "Reply with exactly: ok", maxTokens: 10 });
    console.log(r ? "ANTHROPIC_API_KEY: ✅ working (model replied)" : "ANTHROPIC_API_KEY: ❌ set but the call failed (bad key or no API credit)");
  }

  // Google Places
  if (!isPlacesConfigured()) {
    console.log("GOOGLE_PLACES_API_KEY: not set");
  } else {
    try {
      const p = await placesSearch({ textQuery: "property management in Springfield, IL" });
      console.log(`GOOGLE_PLACES_API_KEY: ✅ working (${p.candidates.length} results on a test query)`);
    } catch (e) {
      console.log(`GOOGLE_PLACES_API_KEY: ❌ set but the call failed — ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
