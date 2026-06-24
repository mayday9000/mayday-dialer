"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatPhone } from "@/lib/phone";
import { cn } from "@/lib/utils";
import { markVoicemailHandled, addVoicemailLead } from "./actions";
import {
  Voicemail,
  PhoneCall,
  MapPin,
  Check,
  Undo2,
  UserPlus,
  Clock,
  Loader2,
} from "lucide-react";

export type VoicemailVM = {
  id: string;
  leadId: string | null;
  name: string | null; // company/contact when matched
  fromPhone: string | null;
  cityName: string | null;
  campaignName: string | null;
  recordingSid: string | null;
  durationSec: number;
  transcriptStatus: string;
  transcriptText: string | null;
  handled: boolean;
  createdAt: string; // ISO
};

function fmtDuration(s: number): string {
  if (!s || s <= 0) return "0:00";
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

export function InboxClient({ items }: { items: VoicemailVM[] }) {
  const [showHandled, setShowHandled] = useState(false);

  const { unhandled, handled } = useMemo(() => {
    return {
      unhandled: items.filter((v) => !v.handled),
      handled: items.filter((v) => v.handled),
    };
  }, [items]);

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed py-20 text-center">
        <Voicemail className="size-8 text-muted-foreground" />
        <div className="text-sm text-muted-foreground">
          No voicemails yet. When someone calls one of your campaign numbers back, their message
          lands here.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">
            New{" "}
            <span className="font-normal text-muted-foreground">
              {unhandled.length} voicemail{unhandled.length === 1 ? "" : "s"}
            </span>
          </h2>
          {handled.length > 0 && (
            <Button variant="ghost" size="sm" onClick={() => setShowHandled((s) => !s)}>
              {showHandled ? "Hide" : "Show"} handled ({handled.length})
            </Button>
          )}
        </div>
        {unhandled.length === 0 ? (
          <p className="rounded-md border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
            All caught up — no new voicemails.
          </p>
        ) : (
          unhandled.map((v) => <VoicemailCard key={v.id} vm={v} />)
        )}
      </div>

      {showHandled && handled.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-muted-foreground">Handled</h2>
          {handled.map((v) => (
            <VoicemailCard key={v.id} vm={v} />
          ))}
        </div>
      )}
    </div>
  );
}

function VoicemailCard({ vm }: { vm: VoicemailVM }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const title = vm.name || formatPhone(vm.fromPhone) || "Unknown caller";
  const showSubPhone = !!vm.name && !!vm.fromPhone;

  function toggleHandled() {
    startTransition(async () => {
      const r = await markVoicemailHandled(vm.id, !vm.handled);
      if (!r.ok) toast.error(r.error);
    });
  }

  function callBack() {
    if (vm.leadId) {
      router.push(`/dial?lead=${vm.leadId}`);
      return;
    }
    // Unknown caller — make a lead first, then dial it.
    startTransition(async () => {
      const r = await addVoicemailLead(vm.id);
      if (r.ok) router.push(`/dial?lead=${r.leadId}`);
      else toast.error(r.error);
    });
  }

  return (
    <Card className={cn(vm.handled && "opacity-70")}>
      <CardContent className="space-y-3 pt-6">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2 font-medium">
              <Voicemail className="size-4 shrink-0 text-muted-foreground" />
              {vm.leadId ? (
                <Link href={`/leads/${vm.leadId}`} className="truncate hover:underline">
                  {title}
                </Link>
              ) : (
                <span className="truncate">{title}</span>
              )}
              {!vm.leadId && (
                <Badge variant="outline" className="shrink-0">
                  Unknown
                </Badge>
              )}
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
              {showSubPhone && <span>{formatPhone(vm.fromPhone)}</span>}
              {vm.cityName && (
                <span className="flex items-center gap-1">
                  <MapPin className="size-3" />
                  {vm.cityName}
                </span>
              )}
              <span className="flex items-center gap-1">
                <Clock className="size-3" />
                {fmtDuration(vm.durationSec)}
              </span>
              <span>{formatDistanceToNow(new Date(vm.createdAt), { addSuffix: true })}</span>
            </div>
          </div>
          {vm.handled && <Badge variant="secondary">Handled</Badge>}
        </div>

        {vm.recordingSid && (
          <audio
            controls
            preload="none"
            src={`/api/twilio/recording/${vm.recordingSid}`}
            className="h-9 w-full max-w-md"
          />
        )}

        <Transcript status={vm.transcriptStatus} text={vm.transcriptText} />

        <div className="flex flex-wrap items-center gap-2 pt-0.5">
          <Button size="sm" onClick={callBack} disabled={pending}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : <PhoneCall className="size-4" />}
            {vm.leadId ? "Call back" : "Add as lead & call"}
          </Button>
          {!vm.leadId && !pending && (
            <span className="text-xs text-muted-foreground">
              <UserPlus className="mr-1 inline size-3" />
              Adds the caller to your leads
            </span>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto text-muted-foreground"
            onClick={toggleHandled}
            disabled={pending}
          >
            {vm.handled ? (
              <>
                <Undo2 className="size-4" /> Reopen
              </>
            ) : (
              <>
                <Check className="size-4" /> Mark handled
              </>
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function Transcript({ status, text }: { status: string; text: string | null }) {
  if (text) {
    return (
      <div className="rounded-md border-l-2 border-l-primary/40 bg-muted/40 px-3 py-2 text-sm leading-snug">
        {text}
      </div>
    );
  }
  const label =
    status === "processing" || status === "pending"
      ? "Transcribing…"
      : "Transcript unavailable — play the recording above.";
  return <p className="text-xs italic text-muted-foreground">{label}</p>;
}
