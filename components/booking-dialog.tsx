"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createBooking } from "@/app/(app)/bookings/actions";
import {
  fillBookingTemplate,
  DEFAULT_MEETING_TITLE,
  DEFAULT_MEETING_DESCRIPTION,
  DEFAULT_MEETING_DURATION,
} from "@/lib/booking";
import { ExternalLink, CalendarX, Mail } from "lucide-react";

function defaultStart(): string {
  const d = new Date();
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 1);
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 16);
}

function embedUrl(email: string, dateLocal: string): string {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const p = new URLSearchParams({
    src: email,
    ctz: tz,
    mode: "WEEK",
    showTitle: "0",
    showPrint: "0",
    showCalendars: "0",
    showTabs: "0",
    showNav: "1",
  });
  const ymd = dateLocal.slice(0, 10).replace(/-/g, "");
  if (ymd.length === 8) p.set("dates", `${ymd}/${ymd}`);
  return `https://calendar.google.com/calendar/embed?${p.toString()}`;
}

export type BookingLeadInfo = {
  companyName: string | null;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  city: string | null;
};

export type BookingDefaults = {
  titleTemplate?: string | null;
  descriptionTemplate?: string | null;
  durationMin?: number | null;
  location?: string | null;
} | null;

export function BookingDialog({
  open,
  onOpenChange,
  leadId,
  leadName,
  lead,
  defaults,
  googleEmail,
  onBooked,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  leadId: string;
  leadName: string;
  lead: BookingLeadInfo;
  defaults?: BookingDefaults;
  googleEmail?: string | null;
  onBooked?: () => void;
}) {
  const router = useRouter();
  // Prefilled from the campaign defaults + the lead. The dialog is keyed by
  // lead id at the call site, so these re-init per lead.
  const [title, setTitle] = useState(() =>
    fillBookingTemplate(defaults?.titleTemplate || DEFAULT_MEETING_TITLE, lead),
  );
  const [startAt, setStartAt] = useState(defaultStart());
  const [duration, setDuration] = useState(String(defaults?.durationMin ?? DEFAULT_MEETING_DURATION));
  const [attendeeEmail, setAttendeeEmail] = useState(lead.email ?? "");
  const [location, setLocation] = useState(defaults?.location ?? "");
  const [notes, setNotes] = useState(() =>
    fillBookingTemplate(defaults?.descriptionTemplate || DEFAULT_MEETING_DESCRIPTION, lead),
  );
  const [pending, startTransition] = useTransition();

  function submit() {
    startTransition(async () => {
      const res = await createBooking({
        leadId,
        title: title.trim() || `Call: ${leadName}`,
        startAt: new Date(startAt).toISOString(),
        durationMin: Number(duration),
        notes,
        attendeeEmail: attendeeEmail.trim() || undefined,
        location: location.trim() || undefined,
      });
      if (res.ok) {
        toast.success(
          res.synced
            ? attendeeEmail.trim()
              ? "Booked + invite sent"
              : "Booked + added to Google Calendar"
            : "Meeting booked",
        );
        onOpenChange(false);
        onBooked?.();
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  }

  const showCalendar = !!googleEmail;

  const form = (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="b-title">Title</Label>
        <Input id="b-title" value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="b-email" className="flex items-center gap-1.5">
          <Mail className="size-3.5" />
          Invite email
        </Label>
        <Input
          id="b-email"
          type="email"
          value={attendeeEmail}
          onChange={(e) => setAttendeeEmail(e.target.value)}
          placeholder="lead@company.com"
        />
        <p className="text-xs text-muted-foreground">
          {attendeeEmail.trim()
            ? "They'll get a Google Calendar invite."
            : "Add an email to send the lead an invite (optional)."}
        </p>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="b-when">When</Label>
          <Input
            id="b-when"
            type="datetime-local"
            value={startAt}
            onChange={(e) => setStartAt(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label>Duration</Label>
          <Select value={duration} onValueChange={setDuration}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="15">15 min</SelectItem>
              <SelectItem value="30">30 min</SelectItem>
              <SelectItem value="45">45 min</SelectItem>
              <SelectItem value="60">60 min</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="b-loc">Location</Label>
        <Input
          id="b-loc"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          placeholder="Phone / Zoom link (optional)"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="b-notes">Description</Label>
        <Textarea id="b-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
      </div>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={showCalendar ? "sm:max-w-4xl" : "max-w-lg"}>
        <DialogHeader>
          <DialogTitle>Book a meeting</DialogTitle>
          <DialogDescription>
            {showCalendar
              ? "Your live calendar is on the left — pick a free slot; the lead gets a Google invite."
              : "Creates an event on your Google Calendar (if connected)."}
          </DialogDescription>
        </DialogHeader>

        {showCalendar ? (
          <div className="grid gap-4 md:grid-cols-[1.5fr_1fr]">
            <div className="flex flex-col gap-2">
              <iframe
                key={startAt.slice(0, 10)}
                title="Your Google Calendar"
                src={embedUrl(googleEmail!, startAt)}
                className="h-[40dvh] w-full rounded-md border md:h-110"
              />
              <a
                href="https://calendar.google.com/calendar/r"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              >
                Open full Google Calendar
                <ExternalLink className="size-3" />
              </a>
            </div>
            {form}
          </div>
        ) : (
          <>
            {form}
            <div className="flex items-center gap-2 rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
              <CalendarX className="size-3.5" />
              Connect Google Calendar in Settings to see availability + send invites.
            </div>
          </>
        )}

        <DialogFooter>
          <Button onClick={submit} disabled={pending}>
            {pending ? "Booking…" : "Book meeting"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
