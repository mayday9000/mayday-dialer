"use client";

import { useEffect, useState } from "react";
import { useDialerCtx } from "@/components/dialer-provider";
import { toE164 } from "@/lib/phone";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Phone } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Ad-hoc dialing: call any number without a lead or campaign — for testing the
 * line end-to-end and one-off calls. Uses the same browser Device as the dial
 * cockpit, so recording still applies; the call just isn't attributed to a
 * lead (no call log / transcript row — the recording lives in Twilio).
 * Once connected, the floating CallBar takes over for mute/hangup.
 */
export function QuickDial({ onNavigate }: { onNavigate?: () => void }) {
  const { call, inCall, status, error, ensureReady, isStub } = useDialerCtx();
  const [open, setOpen] = useState(false);
  const [raw, setRaw] = useState("");

  const e164 = toE164(raw);
  const valid = !!e164;

  // Warm up the Twilio Device as soon as the dialog opens, so the first call
  // doesn't pay init latency.
  useEffect(() => {
    if (open) ensureReady();
  }, [open, ensureReady]);

  // The CallBar owns the in-call UI; close the dialog once the call is placed
  // (sync to the dialer's external state, same pattern as the nav drawer).
  useEffect(() => {
    if (open && inCall) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setOpen(false);
      onNavigate?.();
    }
  }, [open, inCall, onNavigate]);

  function placeCall() {
    if (!e164 || inCall) return;
    call(e164, { id: "", name: `Quick dial ${e164}` });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-sidebar-accent/60 hover:text-foreground"
          type="button"
        >
          <Phone className="size-4" />
          Quick dial
        </button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Quick dial</DialogTitle>
          <DialogDescription>
            Call any number — no lead or campaign attached.
            {isStub
              ? " (Simulated: Twilio is not configured.)"
              : " The call records like any other."}
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            placeCall();
          }}
          className="flex flex-col gap-3"
        >
          <Input
            autoFocus
            type="tel"
            inputMode="tel"
            placeholder="(615) 555-0123"
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            className="text-base tabular-nums"
          />
          <div className="flex items-center justify-between gap-2">
            <span
              className={cn(
                "min-h-4 text-xs",
                error ? "text-destructive" : "text-muted-foreground",
              )}
            >
              {error ?? (raw && !valid ? "Enter a valid phone number" : e164 ?? "")}
            </span>
            <Button type="submit" disabled={!valid || inCall}>
              <Phone className="size-4" />
              {status === "connecting" || status === "ringing" ? "Calling…" : "Call"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
