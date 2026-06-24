"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { createDialer } from "@/lib/dialer";
import type { CallStatus, Dialer, DialerProviderName } from "@/lib/dialer/types";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { PhoneOff, Mic, MicOff } from "lucide-react";

export type LastCall = { durationSec: number; suggestedOutcome?: string; callSid?: string };
// campaignId/marketId ride along so the TwiML webhook can pick the city's local
// caller ID. marketId is per-lead (the lead's city), so "all cities" sessions
// still route each call through the right local number.
type ActiveLead = { id: string; name: string; campaignId?: string; marketId?: string };

type DialerCtx = {
  status: CallStatus;
  detail: string;
  error: string | null;
  inCall: boolean;
  muted: boolean;
  isStub: boolean;
  lastCall: LastCall | null;
  activeLead: ActiveLead | null;
  call: (toE164: string, lead: ActiveLead) => void;
  hangup: () => void;
  toggleMute: () => void;
  sendDigits: (digits: string) => void;
  clearLastCall: () => void;
  ensureReady: () => void;
  registerOnEnded: (cb: ((info: LastCall) => void) | null) => void;
};

const Ctx = createContext<DialerCtx | null>(null);

export function useDialerCtx(): DialerCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useDialerCtx must be used inside DialerProvider");
  return c;
}

export function DialerProvider({
  provider,
  userId,
  children,
}: {
  provider: DialerProviderName;
  userId: string;
  children: React.ReactNode;
}) {
  const [status, setStatus] = useState<CallStatus>("uninitialized");
  const [detail, setDetail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [lastCall, setLastCall] = useState<LastCall | null>(null);
  const [muted, setMuted] = useState(false);
  const [activeLead, setActiveLead] = useState<ActiveLead | null>(null);

  const onEndedRef = useRef<((info: LastCall) => void) | null>(null);
  const initedRef = useRef(false);

  // Create the dialer once (lazy state init — no device connection until the
  // first call() or ensureReady()). The onCallEnded callback reads onEndedRef,
  // but only ever runs when a call ends (an event), never during render — so
  // the refs-in-render rule is a false positive here.
  // eslint-disable-next-line react-hooks/refs
  const [dialer] = useState<Dialer>(() =>
    createDialer(provider, {
      identity: userId,
      onStatus: (s, det) => {
        setStatus(s);
        if (det) setDetail(det);
      },
      onError: (m) => setError(m),
      onCallEnded: (info) => {
        setLastCall(info);
        onEndedRef.current?.(info);
      },
    }),
  );

  useEffect(() => () => dialer.destroy(), [dialer]);

  const ensureReady = useCallback(() => {
    if (!initedRef.current) {
      initedRef.current = true;
      void dialer.init();
    }
  }, [dialer]);

  const call = useCallback(
    (toE164: string, lead: ActiveLead) => {
      setError(null);
      setLastCall(null);
      setActiveLead(lead);
      void dialer.call(toE164, {
        leadId: lead.id,
        campaignId: lead.campaignId,
        marketId: lead.marketId,
      });
    },
    [dialer],
  );

  const hangup = useCallback(() => dialer.hangup(), [dialer]);
  const toggleMute = useCallback(() => {
    const next = !dialer.isMuted();
    dialer.setMuted(next);
    setMuted(next);
  }, [dialer]);
  const sendDigits = useCallback((digits: string) => dialer.sendDigits(digits), [dialer]);
  const clearLastCall = useCallback(() => setLastCall(null), []);
  const registerOnEnded = useCallback((cb: ((info: LastCall) => void) | null) => {
    onEndedRef.current = cb;
  }, []);

  const inCall = status === "connecting" || status === "ringing" || status === "active";

  const value: DialerCtx = {
    status,
    detail,
    error,
    inCall,
    muted,
    isStub: provider === "stub",
    lastCall,
    activeLead,
    call,
    hangup,
    toggleMute,
    sendDigits,
    clearLastCall,
    ensureReady,
    registerOnEnded,
  };

  return (
    <Ctx.Provider value={value}>
      {children}
      <CallBar />
    </Ctx.Provider>
  );
}

/** Floating control for an in-progress call — visible on any page except the
 *  dial cockpit (which has its own controls). Keeps you in control of the call
 *  even if you navigate away. */
function CallBar() {
  const { inCall, status, muted, activeLead, hangup, toggleMute } = useDialerCtx();
  const pathname = usePathname();
  if (!inCall || pathname === "/dial") return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex items-center gap-3 rounded-full border bg-card px-4 py-2 shadow-lg">
      <span className="flex items-center gap-2 text-sm">
        <span className="size-2 animate-pulse rounded-full bg-green-500" />
        <span className="font-medium">{activeLead?.name ?? "On call"}</span>
        <span className="text-xs capitalize text-muted-foreground">{status}</span>
      </span>
      <Button size="sm" variant="outline" onClick={toggleMute} className={cn(muted && "text-amber-600")}>
        {muted ? <MicOff className="size-4" /> : <Mic className="size-4" />}
      </Button>
      <Button size="sm" variant="destructive" onClick={hangup}>
        <PhoneOff className="size-4" />
        Hang up
      </Button>
    </div>
  );
}
