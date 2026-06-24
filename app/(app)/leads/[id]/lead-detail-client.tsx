"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { LEAD_STATUSES, type LeadStatus } from "@/lib/db/schema";
import { leadStatusLabel } from "@/components/lead-status-badge";
import { updateLead, addLeadNote, deleteLead, type LeadPatch } from "./actions";
import { formatPhone } from "@/lib/phone";
import { cn } from "@/lib/utils";
import { TranscriptDialog, type TranscriptDTO } from "@/components/transcript-dialog";
import {
  ExternalLink,
  Trash2,
  StickyNote,
  PhoneCall,
  ArrowRightLeft,
  CalendarCheck,
  Upload,
  Info,
  Voicemail,
  FileAudio,
  Sparkles,
} from "lucide-react";
import { format } from "date-fns";

export type LeadDTO = {
  id: string;
  companyName: string | null;
  contactName: string | null;
  title: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  status: LeadStatus;
  callbackAt: string | null;
  customFields: Record<string, string> | null;
  source: string | null;
};

export type EventDTO = {
  id: string;
  type: string;
  body: string | null;
  outcome: string | null;
  createdAt: string;
  authorName: string | null;
  recordingSid?: string | null;
  ai?: boolean; // AI-written auto note
};

function withProtocol(url: string) {
  if (!url) return "";
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

export function LeadDetailClient({
  lead,
  events,
  backHref = "/",
  transcripts = [],
  engineConfigured = false,
}: {
  lead: LeadDTO;
  events: EventDTO[];
  backHref?: string;
  transcripts?: (TranscriptDTO & { createdAt: string })[];
  engineConfigured?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function save(patch: LeadPatch, label?: string) {
    startTransition(async () => {
      const res = await updateLead(lead.id, patch);
      if (res.ok) {
        if (label) toast.success(label);
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  }

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_380px]">
      {/* Left: editable details */}
      <div className="space-y-6">
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">Details</CardTitle>
            <Select
              value={lead.status}
              onValueChange={(v) => save({ status: v as LeadStatus }, "Status updated")}
              disabled={pending}
            >
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LEAD_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {leadStatusLabel(s)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <EditableField label="Company" value={lead.companyName} onSave={(v) => save({ companyName: v }, "Saved")} />
            <EditableField label="Contact name" value={lead.contactName} onSave={(v) => save({ contactName: v }, "Saved")} />
            <EditableField label="Title" value={lead.title} onSave={(v) => save({ title: v }, "Saved")} />
            <EditableField label="Phone" value={lead.phone} onSave={(v) => save({ phone: v }, "Saved")} format={formatPhone} />
            <EditableField label="Email" value={lead.email} type="email" onSave={(v) => save({ email: v }, "Saved")} />
            <div className="sm:col-span-2">
              <EditableField
                label="Website"
                value={lead.website}
                placeholder="example.com"
                onSave={(v) => save({ website: v }, "Saved")}
                trailing={
                  lead.website ? (
                    <a
                      href={withProtocol(lead.website)}
                      target="_blank"
                      rel="noreferrer"
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <ExternalLink className="size-4" />
                    </a>
                  ) : null
                }
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Callback</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap items-end gap-3">
            <div className="w-full space-y-1.5 sm:w-auto">
              <Label className="text-xs text-muted-foreground">When to call back</Label>
              <Input
                type="datetime-local"
                className="w-full sm:w-60"
                defaultValue={lead.callbackAt ? toLocalInput(lead.callbackAt) : ""}
                onChange={(e) => {
                  const v = e.target.value;
                  save({ callbackAt: v ? new Date(v).toISOString() : null }, v ? "Callback set" : "Callback cleared");
                }}
              />
            </div>
            {lead.callbackAt && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => save({ callbackAt: null }, "Callback cleared")}
                disabled={pending}
              >
                Clear
              </Button>
            )}
          </CardContent>
        </Card>

        {lead.customFields && Object.keys(lead.customFields).length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Info className="size-4 text-muted-foreground" />
                Extra fields from import
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2 sm:grid-cols-2">
              {Object.entries(lead.customFields).map(([k, v]) => (
                <div key={k} className="rounded-md border px-3 py-2">
                  <div className="text-xs text-muted-foreground">{k}</div>
                  <div className="text-sm">{v}</div>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="flex items-center gap-2 text-base">
              <FileAudio className="size-4 text-muted-foreground" />
              Recordings &amp; transcripts
            </CardTitle>
            <span className="text-xs text-muted-foreground">{transcripts.length}</span>
          </CardHeader>
          <CardContent className="space-y-2">
            {transcripts.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">
                No recordings yet. Recorded calls show up here with their transcript.
              </p>
            ) : (
              transcripts.map((t) => (
                <div key={t.id} className="space-y-2 rounded-md border px-3 py-2 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-medium">{format(new Date(t.createdAt), "MMM d, p")}</div>
                      <div className="text-xs text-muted-foreground">
                        {t.segments.length
                          ? `${t.segments.length} lines`
                          : t.status === "processing"
                            ? "Transcribing…"
                            : t.recordingSid
                              ? "Recorded"
                              : "No transcript"}
                        {t.source !== "manual" ? ` · ${t.source.replace(/_/g, " ")}` : " · manual"}
                      </div>
                    </div>
                    <TranscriptDialog
                      transcript={t}
                      leadId={lead.id}
                      callLogId={t.callLogId}
                      recordingSid={t.recordingSid}
                      engineConfigured={engineConfigured}
                      triggerVariant="outline"
                    />
                  </div>
                  {t.analysis?.summary && (
                    <p className="line-clamp-3 text-xs text-muted-foreground">
                      {t.analysis.summary}
                    </p>
                  )}
                  {t.recordingSid && (
                    <audio
                      controls
                      preload="none"
                      src={`/api/twilio/recording/${t.recordingSid}`}
                      className="h-8 w-full"
                    />
                  )}
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <div className="flex justify-end">
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground hover:text-destructive"
            onClick={() => {
              if (!confirm("Delete this lead and its history? This cannot be undone.")) return;
              startTransition(async () => {
                const res = await deleteLead(lead.id);
                if (res.ok) {
                  toast.success("Lead deleted");
                  router.push(backHref);
                } else toast.error(res.error);
              });
            }}
            disabled={pending}
          >
            <Trash2 className="size-4" />
            Delete lead
          </Button>
        </div>
      </div>

      {/* Right: activity timeline */}
      <div>
        <Card className="h-fit">
          <CardHeader>
            <CardTitle className="text-base">Activity &amp; notes</CardTitle>
          </CardHeader>
          <CardContent>
            <NoteComposer leadId={lead.id} onAdded={() => router.refresh()} />
            <Separator className="my-4" />
            {events.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                No activity yet. Add a note as you work this lead.
              </p>
            ) : (
              <ol className="space-y-4">
                {events.map((e) => (
                  <TimelineItem key={e.id} event={e} />
                ))}
              </ol>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function NoteComposer({ leadId, onAdded }: { leadId: string; onAdded: () => void }) {
  const [body, setBody] = useState("");
  const [pending, startTransition] = useTransition();

  function submit() {
    if (!body.trim()) return;
    startTransition(async () => {
      const res = await addLeadNote(leadId, body);
      if (res.ok) {
        setBody("");
        onAdded();
      } else toast.error(res.error);
    });
  }

  return (
    <div className="space-y-2">
      <Textarea
        placeholder="Log what happened — “gatekeeper said call back Wed AM”…"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") submit();
        }}
        rows={3}
      />
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">⌘/Ctrl + Enter</span>
        <Button size="sm" onClick={submit} disabled={pending || !body.trim()}>
          Add note
        </Button>
      </div>
    </div>
  );
}

const EVENT_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  note: StickyNote,
  call: PhoneCall,
  voicemail: Voicemail,
  status_change: ArrowRightLeft,
  booking: CalendarCheck,
  import: Upload,
  system: Info,
};

function TimelineItem({ event }: { event: EventDTO }) {
  const Icon = event.ai ? Sparkles : EVENT_ICON[event.type] ?? StickyNote;
  return (
    <li className="flex gap-3">
      <div
        className={cn(
          "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full",
          event.ai ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground",
        )}
      >
        <Icon className="size-3.5" />
      </div>
      <div className="min-w-0 flex-1">
        {event.ai && (
          <div className="mb-0.5 text-[11px] font-semibold uppercase tracking-wide text-primary">
            Auto call notes
          </div>
        )}
        <div className="whitespace-pre-wrap text-sm">{event.body}</div>
        {event.type === "voicemail" && event.recordingSid && (
          <audio
            controls
            preload="none"
            src={`/api/twilio/recording/${event.recordingSid}`}
            className="mt-1.5 h-9 w-full max-w-xs"
          />
        )}
        <div className="mt-0.5 text-xs text-muted-foreground">
          {event.authorName ? `${event.authorName} · ` : ""}
          {format(new Date(event.createdAt), "MMM d, p")}
        </div>
      </div>
    </li>
  );
}

function EditableField({
  label,
  value,
  onSave,
  placeholder,
  type = "text",
  format,
  trailing,
}: {
  label: string;
  value: string | null;
  onSave: (v: string) => void;
  placeholder?: string;
  type?: string;
  format?: (v: string) => string;
  trailing?: React.ReactNode;
}) {
  const [val, setVal] = useState(value ?? "");
  const original = value ?? "";

  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <div className="flex items-center gap-2">
        <Input
          type={type}
          value={val}
          placeholder={placeholder}
          onChange={(e) => setVal(e.target.value)}
          onBlur={() => {
            if (val !== original) onSave(val);
          }}
        />
        {trailing}
      </div>
      {format && val && val === original && (
        <div className="text-xs text-muted-foreground">{format(val)}</div>
      )}
    </div>
  );
}

function toLocalInput(iso: string) {
  const d = new Date(iso);
  const off = d.getTimezoneOffset();
  const local = new Date(d.getTime() - off * 60000);
  return local.toISOString().slice(0, 16);
}
