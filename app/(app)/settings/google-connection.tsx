"use client";

import { useEffect, useTransition } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { disconnectGoogleAction } from "@/app/(app)/bookings/actions";
import { CalendarCheck, CalendarX, TriangleAlert, RefreshCw } from "lucide-react";

export function GoogleConnection({
  status,
  configured,
}: {
  status: { connected: boolean; email: string | null; stale: boolean };
  configured: boolean;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    const g = params.get("google");
    if (!g) return;
    if (g === "connected") toast.success("Google Calendar connected");
    else if (g === "error") toast.error("Couldn't connect Google Calendar");
    else if (g === "unconfigured") toast.error("Google isn't configured yet");
    router.replace("/settings");
  }, [params, router]);

  function disconnect() {
    startTransition(async () => {
      await disconnectGoogleAction();
      toast.success("Disconnected");
      router.refresh();
    });
  }

  if (!configured) {
    return (
      <Card>
        <CardContent className="flex items-center justify-between gap-4 py-4">
          <div className="flex items-center gap-3">
            <CalendarX className="size-5 text-muted-foreground" />
            <div>
              <div className="text-sm font-medium">Google Calendar not set up</div>
              <div className="text-xs text-muted-foreground">
                Add Google OAuth credentials to enable real calendar bookings.
              </div>
            </div>
          </div>
          <Badge variant="outline">Setup needed</Badge>
        </CardContent>
      </Card>
    );
  }

  if (!status.connected) {
    return (
      <Card>
        <CardContent className="flex items-center justify-between gap-4 py-4">
          <div className="flex items-center gap-3">
            <CalendarX className="size-5 text-muted-foreground" />
            <div>
              <div className="text-sm font-medium">Google Calendar not connected</div>
              <div className="text-xs text-muted-foreground">
                Connect to create real events when you book a meeting.
              </div>
            </div>
          </div>
          <Button asChild>
            <a href="/api/google/connect">Connect Google Calendar</a>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={status.stale ? "border-amber-400/60" : undefined}>
      <CardContent className="flex items-center justify-between gap-4 py-4">
        <div className="flex items-center gap-3">
          {status.stale ? (
            <TriangleAlert className="size-5 text-amber-500" />
          ) : (
            <CalendarCheck className="size-5 text-green-600" />
          )}
          <div>
            <div className="text-sm font-medium">
              {status.stale ? "Reconnect Google Calendar" : "Google Calendar connected"}
            </div>
            <div className="text-xs text-muted-foreground">
              {status.email ?? "Connected"}
              {status.stale && " · access may have expired (personal Gmail re-auths ~weekly)"}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {status.stale && (
            <Button asChild size="sm">
              <a href="/api/google/connect">
                <RefreshCw className="size-4" />
                Reconnect
              </a>
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={disconnect} disabled={pending}>
            Disconnect
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
