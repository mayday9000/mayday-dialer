import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSession } from "@/lib/auth-server";
import { connectGoogle } from "@/lib/google";

export const runtime = "nodejs";

/** OAuth redirect target: exchanges the code and stores tokens. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  const session = await getSession();
  if (!session?.user) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  if (error) {
    return NextResponse.redirect(new URL(`/settings?google=error`, req.url));
  }

  const jar = await cookies();
  const expected = jar.get("g_oauth_state")?.value;
  jar.delete("g_oauth_state");

  if (!code || !state || !expected || state !== expected) {
    return NextResponse.redirect(new URL("/settings?google=error", req.url));
  }

  try {
    await connectGoogle(session.user.id, code);
    return NextResponse.redirect(new URL("/settings?google=connected", req.url));
  } catch {
    return NextResponse.redirect(new URL("/settings?google=error", req.url));
  }
}
