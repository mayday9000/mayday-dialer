import "server-only";
import { google } from "googleapis";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { googleConnections } from "@/lib/db/schema";

// Calendar scope only — we just create events on the user's calendar.
export const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/userinfo.email",
  "openid",
];

export function isGoogleConfigured(): boolean {
  return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

function redirectUri(): string {
  return (
    process.env.GOOGLE_REDIRECT_URI ||
    `${process.env.BETTER_AUTH_URL ?? "http://localhost:3000"}/api/google/callback`
  );
}

export function oauthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    redirectUri(),
  );
}

/** URL to send the user to for granting calendar access. */
export function getAuthUrl(state: string): string {
  return oauthClient().generateAuthUrl({
    access_type: "offline", // get a refresh token
    prompt: "consent", // force refresh token issuance
    scope: GOOGLE_SCOPES,
    state,
    include_granted_scopes: true,
  });
}

/** Exchange an auth code and persist tokens for the user. */
export async function connectGoogle(userId: string, code: string): Promise<void> {
  const client = oauthClient();
  const { tokens } = await client.getToken(code);
  client.setCredentials(tokens);

  // Look up the connected Google account email (nice to show in UI).
  let email: string | null = null;
  try {
    const oauth2 = google.oauth2({ version: "v2", auth: client });
    const me = await oauth2.userinfo.get();
    email = me.data.email ?? null;
  } catch {
    /* non-fatal */
  }

  const values = {
    userId,
    googleEmail: email,
    accessToken: tokens.access_token ?? null,
    refreshToken: tokens.refresh_token ?? null,
    expiryDate: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
    scope: tokens.scope ?? GOOGLE_SCOPES.join(" "),
    connectedAt: new Date(),
    updatedAt: new Date(),
  };

  await db
    .insert(googleConnections)
    .values(values)
    .onConflictDoUpdate({
      target: googleConnections.userId,
      set: {
        googleEmail: values.googleEmail,
        accessToken: values.accessToken,
        // Google only returns a refresh token on first consent; keep the old
        // one if this exchange didn't include a new one.
        ...(values.refreshToken ? { refreshToken: values.refreshToken } : {}),
        expiryDate: values.expiryDate,
        scope: values.scope,
        connectedAt: values.connectedAt,
        updatedAt: values.updatedAt,
      },
    });
}

export async function disconnectGoogle(userId: string): Promise<void> {
  await db.delete(googleConnections).where(eq(googleConnections.userId, userId));
}

export type GoogleStatus = {
  connected: boolean;
  email: string | null;
  /** True if we have a connection row but it likely needs re-auth. */
  stale: boolean;
};

export async function getGoogleStatus(userId: string): Promise<GoogleStatus> {
  const conn = await db.query.googleConnections.findFirst({
    where: eq(googleConnections.userId, userId),
  });
  if (!conn || !conn.refreshToken) return { connected: false, email: null, stale: false };
  // Personal-Gmail (External/Testing) refresh tokens lapse ~weekly; flag if old.
  const stale =
    !!conn.connectedAt &&
    Date.now() - new Date(conn.connectedAt).getTime() > 6.5 * 24 * 60 * 60 * 1000;
  return { connected: true, email: conn.googleEmail, stale };
}

/**
 * Returns an authenticated calendar client for the user, or null if they
 * haven't connected Google. Auto-refreshes the access token and persists it.
 */
async function calendarForUser(userId: string) {
  if (!isGoogleConfigured()) return null;
  const conn = await db.query.googleConnections.findFirst({
    where: eq(googleConnections.userId, userId),
  });
  if (!conn?.refreshToken) return null;

  const client = oauthClient();
  client.setCredentials({
    access_token: conn.accessToken ?? undefined,
    refresh_token: conn.refreshToken,
    expiry_date: conn.expiryDate ? conn.expiryDate.getTime() : undefined,
  });

  // Persist refreshed tokens.
  client.on("tokens", (tokens) => {
    void db
      .update(googleConnections)
      .set({
        accessToken: tokens.access_token ?? conn.accessToken,
        expiryDate: tokens.expiry_date ? new Date(tokens.expiry_date) : conn.expiryDate,
        ...(tokens.refresh_token ? { refreshToken: tokens.refresh_token } : {}),
        updatedAt: new Date(),
      })
      .where(eq(googleConnections.userId, userId));
  });

  return {
    calendar: google.calendar({ version: "v3", auth: client }),
    calendarId: conn.calendarId || "primary",
  };
}

export type CalendarEvent = { id: string; htmlLink: string };

/** Creates a calendar event for the user. Returns null if not connected. */
export async function createCalendarEvent(
  userId: string,
  input: {
    summary: string;
    description?: string;
    location?: string;
    start: Date;
    end: Date;
    attendees?: string[]; // emails — they get a Google invite
  },
): Promise<CalendarEvent | null> {
  const ctx = await calendarForUser(userId);
  if (!ctx) return null;

  const attendees = (input.attendees ?? []).filter(Boolean).map((email) => ({ email }));

  const res = await ctx.calendar.events.insert({
    calendarId: ctx.calendarId,
    sendUpdates: attendees.length ? "all" : "none",
    requestBody: {
      summary: input.summary,
      description: input.description || undefined,
      location: input.location || undefined,
      start: { dateTime: input.start.toISOString() },
      end: { dateTime: input.end.toISOString() },
      ...(attendees.length ? { attendees } : {}),
    },
  });

  return {
    id: res.data.id ?? "",
    htmlLink: res.data.htmlLink ?? "",
  };
}
