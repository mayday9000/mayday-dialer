import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth-server";

export const runtime = "nodejs";

/** Authenticated proxy for a Twilio recording. Streams inline for the in-app
 *  player; add ?dl=1 to force a download (Content-Disposition attachment). */
export async function GET(req: Request, ctx: RouteContext<"/api/twilio/recording/[sid]">) {
  const session = await getSession();
  if (!session?.user) return new NextResponse("Unauthorized", { status: 401 });

  const { sid } = await ctx.params;
  if (!/^RE[a-zA-Z0-9]+$/.test(sid)) return new NextResponse("Bad request", { status: 400 });

  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!accountSid || !token) return new NextResponse("Not configured", { status: 501 });

  const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Recordings/${sid}.mp3`;
  // Forward the browser's Range request to Twilio (whose media supports it) so
  // the <audio> player can read the duration and SCRUB — without this the
  // scrubber jumps to the end and seeking is dead.
  const range = req.headers.get("range");
  const r = await fetch(url, {
    headers: {
      Authorization: "Basic " + Buffer.from(`${accountSid}:${token}`).toString("base64"),
      ...(range ? { Range: range } : {}),
    },
  });
  if (!r.ok || !r.body) return new NextResponse("Recording not found", { status: 404 });

  const download = new URL(req.url).searchParams.get("dl");
  const headers = new Headers();
  headers.set("Content-Type", r.headers.get("content-type") || "audio/mpeg");
  headers.set("Accept-Ranges", "bytes");
  headers.set("Cache-Control", "private, max-age=3600");
  // Pass through size/range so the player knows total length + partial position.
  const len = r.headers.get("content-length");
  if (len) headers.set("Content-Length", len);
  const contentRange = r.headers.get("content-range");
  if (contentRange) headers.set("Content-Range", contentRange);
  if (download) headers.set("Content-Disposition", `attachment; filename="recording-${sid}.mp3"`);

  // 206 when a range was served, else 200.
  return new NextResponse(r.body, { status: r.status, headers });
}
