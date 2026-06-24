import { NextResponse } from "next/server";
import twilio from "twilio";

export const runtime = "nodejs";

/**
 * Inbound calls to our number (e.g. a prospect calling back the caller ID they
 * saw). Greets and takes a voicemail so callbacks are never dropped. The
 * recording is handed to /api/twilio/voicemail, which files it on the matching
 * lead's timeline.
 */
export async function POST() {
  const base = process.env.BETTER_AUTH_URL || "";
  const VoiceResponse = twilio.twiml.VoiceResponse;
  const twiml = new VoiceResponse();

  twiml.say(
    { voice: "Polly.Joanna" },
    "Thanks for calling Mayday AI. Please leave a message after the tone and we'll get right back to you. Your message may be recorded.",
  );
  twiml.record({
    maxLength: 120,
    playBeep: true,
    finishOnKey: "#",
    action: `${base}/api/twilio/voicemail`,
    method: "POST",
  });
  twiml.say("We didn't catch a message. Goodbye.");
  twiml.hangup();

  return new NextResponse(twiml.toString(), { headers: { "Content-Type": "text/xml" } });
}
