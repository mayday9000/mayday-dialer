import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { randomBytes } from "crypto";
import { getSession } from "@/lib/auth-server";
import { getAuthUrl, isGoogleConfigured } from "@/lib/google";

export const runtime = "nodejs";

/** Kicks off the Google OAuth consent flow for the logged-in user. */
export async function GET(req: Request) {
  const session = await getSession();
  if (!session?.user) {
    return NextResponse.redirect(new URL("/login", req.url));
  }
  if (!isGoogleConfigured()) {
    return NextResponse.redirect(new URL("/settings?google=unconfigured", req.url));
  }

  // CSRF protection: random state echoed back and checked at the callback.
  const state = randomBytes(16).toString("hex");
  const jar = await cookies();
  jar.set("g_oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 600,
    path: "/",
  });

  return NextResponse.redirect(getAuthUrl(state));
}
