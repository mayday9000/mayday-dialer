"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { leads, leadEvents, bookings } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth-server";
import { createCalendarEvent, disconnectGoogle } from "@/lib/google";
import { format } from "date-fns";

export type BookingResult =
  | { ok: true; bookingId: string; synced: boolean; meetingLink?: string | null }
  | { ok: false; error: string };

export async function createBooking(input: {
  leadId: string;
  title?: string;
  startAt: string; // ISO
  durationMin?: number;
  notes?: string;
  attendeeEmail?: string;
  location?: string;
}): Promise<BookingResult> {
  const user = await requireUser();

  const lead = await db.query.leads.findFirst({ where: eq(leads.id, input.leadId) });
  if (!lead) return { ok: false, error: "Lead not found." };

  const start = new Date(input.startAt);
  if (isNaN(start.getTime())) return { ok: false, error: "Pick a valid date/time." };
  const durationMin = input.durationMin ?? 30;
  const end = new Date(start.getTime() + durationMin * 60 * 1000);
  const title =
    input.title?.trim() ||
    `Call: ${lead.companyName || lead.contactName || "Lead"}`;

  const attendeeEmail = input.attendeeEmail?.trim() || null;
  if (attendeeEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(attendeeEmail)) {
    return { ok: false, error: "That invite email doesn't look valid." };
  }

  // Try to create a real Google Calendar event for this user. If they haven't
  // connected Google yet, we still record the booking locally.
  let googleEventId: string | null = null;
  let meetingLink: string | null = null;
  let synced = false;
  try {
    const ev = await createCalendarEvent(user.id, {
      summary: title,
      description: [input.notes, lead.phone ? `Phone: ${lead.phone}` : null]
        .filter(Boolean)
        .join("\n"),
      location: input.location?.trim() || undefined,
      start,
      end,
      attendees: attendeeEmail ? [attendeeEmail] : [],
    });
    if (ev) {
      googleEventId = ev.id;
      meetingLink = ev.htmlLink;
      synced = true;
    }
  } catch {
    // Calendar sync is best-effort; never block recording the booking.
  }

  const [row] = await db
    .insert(bookings)
    .values({
      leadId: input.leadId,
      userId: user.id,
      title,
      startAt: start,
      endAt: end,
      notes: input.notes?.trim() || null,
      googleEventId,
      meetingLink,
      status: "scheduled",
    })
    .returning({ id: bookings.id });

  await db.insert(leadEvents).values({
    leadId: input.leadId,
    userId: user.id,
    type: "booking",
    body: `Booked ${format(start, "EEE MMM d, p")}${synced ? " (added to Google Calendar)" : ""}`,
  });

  await db
    .update(leads)
    .set({ status: "booked", updatedAt: new Date() })
    .where(eq(leads.id, input.leadId));

  revalidatePath(`/leads/${input.leadId}`);
  revalidatePath("/bookings");
  revalidatePath("/");
  return { ok: true, bookingId: row.id, synced, meetingLink };
}

export async function cancelBooking(id: string): Promise<{ ok: boolean }> {
  await requireUser();
  await db.update(bookings).set({ status: "canceled" }).where(eq(bookings.id, id));
  revalidatePath("/bookings");
  return { ok: true };
}

export async function disconnectGoogleAction(): Promise<{ ok: boolean }> {
  const user = await requireUser();
  await disconnectGoogle(user.id);
  revalidatePath("/settings");
  return { ok: true };
}
