// Twilio local-presence numbers: search, buy, and resolve the outbound caller
// ID for a call. Shared by the campaign launch wizard and the per-city "Add
// city" flow, and by the TwiML voice webhook (which picks the caller ID).
//
// Server-only (talks to Twilio + the DB). Never import from a client component.
import twilio from "twilio";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { campaignNumbers } from "@/lib/db/schema";

export type AvailableNumber = { phoneNumber: string; friendly: string };

function client() {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) return null;
  return twilio(sid, token);
}

/** Inbound voice URL for a purchased number, derived from the outbound voice
 *  webhook, so a bought number can also receive calls. */
function inboundVoiceUrl(): string | undefined {
  return process.env.TWILIO_VOICE_URL
    ? process.env.TWILIO_VOICE_URL.replace(/\/voice\/?$/, "/inbound")
    : undefined;
}

/** Find buyable local numbers for an area code (read-only, no charge). */
export async function searchAvailableNumbers(areaCode: string): Promise<AvailableNumber[]> {
  const c = client();
  if (!c) throw new Error("Twilio isn't configured.");
  const ac = areaCode.replace(/\D/g, "").slice(0, 3);
  if (ac.length !== 3) throw new Error("Enter a 3-digit area code.");
  const list = await c
    .availablePhoneNumbers("US")
    .local.list({ areaCode: Number(ac), voiceEnabled: true, limit: 5 });
  return list.map((n) => ({ phoneNumber: n.phoneNumber, friendly: n.friendlyName || n.phoneNumber }));
}

/** Buy a local number (REAL charge) and record it as a campaign/market number.
 *  Throws on failure — callers that treat the purchase as optional should wrap
 *  this in try/catch (the launch flow does). */
export async function buyNumber(opts: {
  phoneNumber: string;
  areaCode?: string | null;
  campaignId?: string | null;
  marketId?: string | null;
  createdBy?: string | null;
}): Promise<typeof campaignNumbers.$inferSelect> {
  const c = client();
  if (!c) throw new Error("Twilio isn't configured.");
  const voiceUrl = inboundVoiceUrl();
  const bought = await c.incomingPhoneNumbers.create({
    phoneNumber: opts.phoneNumber,
    ...(voiceUrl ? { voiceUrl } : {}),
  });
  const [row] = await db
    .insert(campaignNumbers)
    .values({
      campaignId: opts.campaignId ?? null,
      marketId: opts.marketId ?? null,
      e164: bought.phoneNumber,
      twilioSid: bought.sid,
      areaCode: opts.areaCode ?? null,
      createdBy: opts.createdBy ?? null,
    })
    .returning();
  return row;
}

/**
 * Resolve the outbound caller ID for a call, preferring local presence:
 *   1. the city's own number   (campaign + market)
 *   2. a campaign-level number  (campaign, market IS NULL)
 *   3. any number for the campaign
 *   4. the global TWILIO_CALLER_ID env fallback
 *
 * Server-authoritative: callers pass campaignId/marketId only as *lookups*; the
 * number is always re-derived here, never accepted from the client. A marketId
 * that doesn't belong to the campaign simply yields no row and falls through.
 * Fails open to env on any DB error — a transient blip must never block a call.
 */
export async function callerIdFor(
  campaignId: string | null | undefined,
  marketId: string | null | undefined,
): Promise<string | null> {
  const fallback = process.env.TWILIO_CALLER_ID || null;
  if (!campaignId) return fallback;
  try {
    if (marketId) {
      const [n] = await db
        .select({ e164: campaignNumbers.e164 })
        .from(campaignNumbers)
        .where(
          and(eq(campaignNumbers.campaignId, campaignId), eq(campaignNumbers.marketId, marketId)),
        )
        .orderBy(desc(campaignNumbers.createdAt))
        .limit(1);
      if (n?.e164) return n.e164;
    }
    const [campaignLevel] = await db
      .select({ e164: campaignNumbers.e164 })
      .from(campaignNumbers)
      .where(and(eq(campaignNumbers.campaignId, campaignId), isNull(campaignNumbers.marketId)))
      .orderBy(desc(campaignNumbers.createdAt))
      .limit(1);
    if (campaignLevel?.e164) return campaignLevel.e164;
    const [anyNumber] = await db
      .select({ e164: campaignNumbers.e164 })
      .from(campaignNumbers)
      .where(eq(campaignNumbers.campaignId, campaignId))
      .orderBy(desc(campaignNumbers.createdAt))
      .limit(1);
    if (anyNumber?.e164) return anyNumber.e164;
  } catch {
    /* fall through to env fallback */
  }
  return fallback;
}
