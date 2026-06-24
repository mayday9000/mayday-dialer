import { NextResponse } from "next/server";
import twilio from "twilio";
import { transcriptionConfig } from "@/lib/transcription/config";
import { callerIdFor } from "@/lib/dialer/numbers";

export const runtime = "nodejs";

/** Absolute URL Twilio should POST recording-status events to, carrying the
 *  leadId/userId so the recording can be attributed without the call params.
 *  Derived from TWILIO_VOICE_URL when set, else the inbound request origin. */
function recordingCallbackUrl(reqUrl: string, leadId: string, userId: string): string {
  const base = process.env.TWILIO_VOICE_URL
    ? process.env.TWILIO_VOICE_URL.replace(/\/voice\/?$/, "/recording")
    : new URL("/api/twilio/recording", reqUrl).toString();
  const u = new URL(base);
  if (leadId) u.searchParams.set("leadId", leadId);
  if (userId) u.searchParams.set("userId", userId);
  return u.toString();
}

/**
 * TwiML webhook hit by Twilio when the browser Device places an outbound
 * call. We bridge to the dialed PSTN number using the verified caller ID.
 *
 * Configure this URL as the Voice Request URL on your TwiML App.
 */
export async function POST(req: Request) {
  const form = await req.formData();
  const to = String(form.get("To") || "").trim();
  const leadId = String(form.get("leadId") || "").trim();
  const from = String(form.get("From") || "").trim(); // "client:<userId>"
  const userId = from.startsWith("client:") ? from.slice("client:".length) : "";
  // The campaign + city this call is made under (sent as connect params by the
  // browser dialer). Used only as a lookup to pick the local caller ID — the
  // number itself is re-derived server-side below, never trusted from the client.
  const campaignId = String(form.get("campaignId") || "").trim() || null;
  const marketId = String(form.get("marketId") || "").trim() || null;

  // Validate the request actually came from Twilio (when we have the token).
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (authToken) {
    const signature = req.headers.get("x-twilio-signature") || "";
    const url = process.env.TWILIO_VOICE_URL || req.url;
    const params: Record<string, string> = {};
    form.forEach((v, k) => (params[k] = String(v)));
    const valid = twilio.validateRequest(authToken, signature, url, params);
    if (!valid) {
      return new NextResponse("Invalid signature", { status: 403 });
    }
  }

  // Local-presence caller ID for this city, falling back to the campaign-level
  // number and finally the global TWILIO_CALLER_ID env.
  const callerId = await callerIdFor(campaignId, marketId);

  const VoiceResponse = twilio.twiml.VoiceResponse;
  const twiml = new VoiceResponse();

  if (!to || !callerId) {
    twiml.say("This dialer is not fully configured. Goodbye.");
    twiml.hangup();
  } else if (transcriptionConfig.recordCalls) {
    // Dual-channel recording (agent + prospect on separate channels) is what
    // lets the transcript attribute each line to a speaker. Gated by env so
    // recording can be turned off without code changes.
    const dial = twiml.dial({
      callerId,
      answerOnBridge: true,
      record: "record-from-answer-dual",
      recordingStatusCallback: recordingCallbackUrl(req.url, leadId, userId),
      recordingStatusCallbackEvent: ["completed"],
    });
    dial.number(to);
  } else {
    const dial = twiml.dial({ callerId, answerOnBridge: true });
    dial.number(to);
  }

  return new NextResponse(twiml.toString(), {
    headers: { "Content-Type": "text/xml" },
  });
}
