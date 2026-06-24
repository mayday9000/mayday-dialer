import { NextResponse } from "next/server";
import twilio from "twilio";
import { getSession } from "@/lib/auth-server";

export const runtime = "nodejs";

/**
 * Mints a short-lived Twilio Voice access token for the logged-in user.
 * Returns 501 when Twilio isn't configured yet (the app runs on the stub
 * dialer until then).
 */
export async function POST() {
  const session = await getSession();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const apiKeySid = process.env.TWILIO_API_KEY_SID;
  const apiKeySecret = process.env.TWILIO_API_KEY_SECRET;
  const twimlAppSid = process.env.TWILIO_TWIML_APP_SID;

  if (!accountSid || !apiKeySid || !apiKeySecret || !twimlAppSid) {
    return NextResponse.json({ error: "Twilio is not configured." }, { status: 501 });
  }

  const { AccessToken } = twilio.jwt;
  const { VoiceGrant } = AccessToken;

  const token = new AccessToken(accountSid, apiKeySid, apiKeySecret, {
    identity: session.user.id,
    ttl: 86400, // 24h (Twilio max); the dialer also refreshes before each call
  });
  token.addGrant(
    new VoiceGrant({
      outgoingApplicationSid: twimlAppSid,
      incomingAllow: false,
    }),
  );

  return NextResponse.json({ token: token.toJwt(), identity: session.user.id });
}
