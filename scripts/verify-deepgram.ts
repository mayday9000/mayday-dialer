/**
 * Verify the Deepgram transcription setup locally.
 *   pnpm exec dotenv -e .env -- tsx scripts/verify-deepgram.ts
 *
 * 1) Confirms DEEPGRAM_API_KEY works against a public sample clip.
 * 2) If any recorded call exists in the DB, runs the real adapter end-to-end
 *    (Twilio recording -> Deepgram -> speaker-separated segments).
 */
import { isNotNull } from "drizzle-orm";
import { db } from "../lib/db";
import { callTranscripts } from "../lib/db/schema";
import { deepgram } from "../lib/transcription/deepgram";
import { transcriptionConfig, autoEngine } from "../lib/transcription/config";

async function main() {
  console.log("Provider:", transcriptionConfig.provider, "| model:", transcriptionConfig.deepgramModel);
  console.log("DEEPGRAM_API_KEY present:", !!transcriptionConfig.deepgramApiKey);
  console.log("Twilio creds present:", !!transcriptionConfig.twilioAccountSid && !!transcriptionConfig.twilioAuthToken);
  console.log("autoEngine() ->", autoEngine() ?? "none (recordings-only/manual)");

  // 1) Key sanity check against Deepgram's public sample.
  console.log("\n[1] Testing the API key against a sample clip…");
  const res = await fetch(
    `https://api.deepgram.com/v1/listen?model=${transcriptionConfig.deepgramModel}&punctuate=true&smart_format=true`,
    {
      method: "POST",
      headers: {
        Authorization: `Token ${transcriptionConfig.deepgramApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ url: "https://dpgr.am/spacewalk.wav" }),
    },
  );
  if (!res.ok) {
    console.error("  FAILED:", res.status, (await res.text()).slice(0, 240));
    process.exit(1);
  }
  const j = (await res.json()) as {
    results?: { channels?: { alternatives?: { transcript?: string }[] }[] };
  };
  const sample = j.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? "";
  console.log("  OK — Deepgram returned:", JSON.stringify(sample.slice(0, 90)) + (sample.length > 90 ? "…" : ""));

  // 2) End-to-end on a real recording, if we have one.
  console.log("\n[2] Looking for an existing recording to transcribe end-to-end…");
  const rows = await db.select().from(callTranscripts).where(isNotNull(callTranscripts.recordingSid)).limit(1);
  if (!rows.length) {
    console.log("  None yet. Recordings are created when a recorded call completes");
    console.log("  (needs the deployed app + TWILIO_RECORD=true, or a tunnel). The key");
    console.log("  is verified, so transcription will run automatically once one exists.");
  } else {
    const t = rows[0];
    console.log(`  Transcribing recording ${t.recordingSid} via the adapter…`);
    const out = await deepgram.transcribe!({ recordingSid: t.recordingSid! });
    console.log("  status:", out.status, "| segments:", out.segments.length, "| error:", out.error ?? "none");
    for (const s of out.segments.slice(0, 4)) {
      console.log(`    ${s.speaker}: ${s.text.slice(0, 70)}`);
    }
  }

  console.log("\nDone.");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
