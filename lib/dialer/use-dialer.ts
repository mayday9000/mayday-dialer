"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createDialer } from "./index";
import type { CallStatus, Dialer, DialerProviderName } from "./types";

export type LastCall = { durationSec: number; suggestedOutcome?: string; callSid?: string };

/** React wrapper around a Dialer implementation. */
export function useDialer(
  provider: DialerProviderName,
  identity?: string,
  onEnded?: (info: LastCall) => void,
) {
  const [status, setStatus] = useState<CallStatus>("uninitialized");
  const [detail, setDetail] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [lastCall, setLastCall] = useState<LastCall | null>(null);
  const [muted, setMutedState] = useState(false);
  const dialerRef = useRef<Dialer | null>(null);

  // Keep the end-handler current without re-initializing the device.
  const onEndedRef = useRef(onEnded);
  useEffect(() => {
    onEndedRef.current = onEnded;
  }, [onEnded]);

  useEffect(() => {
    const d = createDialer(provider, {
      identity,
      onStatus: (s, det) => {
        setStatus(s);
        if (det) setDetail(det);
      },
      onError: (m) => setError(m),
      onCallEnded: (info) => {
        setLastCall(info);
        onEndedRef.current?.(info);
      },
    });
    dialerRef.current = d;
    void d.init();
    return () => {
      d.destroy();
      dialerRef.current = null;
    };
  }, [provider, identity]);

  const call = useCallback((toE164: string) => {
    setError(null);
    setLastCall(null);
    void dialerRef.current?.call(toE164);
  }, []);

  const hangup = useCallback(() => dialerRef.current?.hangup(), []);

  const toggleMute = useCallback(() => {
    const next = !dialerRef.current?.isMuted();
    dialerRef.current?.setMuted(next);
    setMutedState(next);
  }, []);

  const inCall =
    status === "connecting" || status === "ringing" || status === "active";

  return {
    status,
    detail,
    error,
    lastCall,
    muted,
    inCall,
    isStub: provider === "stub",
    call,
    hangup,
    toggleMute,
    clearLastCall: () => setLastCall(null),
  };
}
