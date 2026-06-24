"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { TranscriptView } from "@/components/transcript-view";
import { segmentsToText } from "@/lib/transcripts";
import type { TranscriptSegment, TranscriptStatus, TranscriptSource } from "@/lib/db/schema";
import {
  saveManualTranscript,
  generateTranscript,
  refreshTranscript,
  deleteTranscript,
  regenerateCallNotes,
} from "@/app/(app)/transcripts/actions";
import {
  FileText,
  Download,
  Copy,
  RefreshCw,
  Sparkles,
  Trash2,
  Pencil,
  Loader2,
} from "lucide-react";

export type TranscriptDTO = {
  id: string;
  status: TranscriptStatus;
  source: TranscriptSource;
  segments: TranscriptSegment[];
  text: string;
  recordingSid: string | null;
  language: string | null;
  callLogId: string | null;
  leadId: string;
  callSid: string | null;
  error: string | null;
  analysis: {
    talkRatioAgent?: number;
    summary?: string;
    bullets?: string[];
    nextStep?: string | null;
    sentiment?: string;
  } | null;
};

const STATUS_LABEL: Record<TranscriptStatus, string> = {
  pending: "Recorded · not transcribed",
  processing: "Transcribing…",
  completed: "Transcript ready",
  failed: "Transcription failed",
};

/** View/manage one call's transcript. Trigger reflects current state; the
 *  dialog handles manual entry, auto-generate/refresh, download, and delete. */
export function TranscriptDialog({
  transcript,
  leadId,
  callLogId = null,
  callSid = null,
  recordingSid = null,
  engineConfigured,
  triggerLabel,
  triggerVariant = "ghost",
  triggerSize = "sm",
}: {
  transcript: TranscriptDTO | null;
  leadId: string;
  callLogId?: string | null;
  callSid?: string | null;
  recordingSid?: string | null;
  engineConfigured: boolean;
  triggerLabel?: string;
  triggerVariant?: "ghost" | "outline" | "secondary" | "default";
  triggerSize?: "sm" | "xs" | "default";
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [pending, start] = useTransition();

  const rec = transcript?.recordingSid ?? recordingSid;
  const hasText = !!transcript && transcript.segments.length > 0;
  const status = transcript?.status;

  // Trigger label: explicit > state-derived.
  const label =
    triggerLabel ??
    (hasText
      ? "Transcript"
      : status === "processing"
        ? "Transcribing…"
        : transcript
          ? "Add transcript"
          : "Add transcript");

  function refresh() {
    router.refresh();
  }

  function onSaveManual() {
    start(async () => {
      const res = await saveManualTranscript({
        transcriptId: transcript?.id,
        callLogId,
        leadId,
        callSid,
        rawText: draft,
      });
      if (res.ok) {
        toast.success("Transcript saved");
        setEditing(false);
        refresh();
      } else toast.error(res.error);
    });
  }

  function onGenerate() {
    if (!transcript) return;
    start(async () => {
      const res = await generateTranscript(transcript.id);
      if (res.ok) {
        toast.success("Transcription started — refresh in a moment");
        refresh();
      } else toast.error(res.error);
    });
  }

  function onRefresh() {
    if (!transcript) return;
    start(async () => {
      const res = await refreshTranscript(transcript.id);
      if (res.ok) {
        toast.success(res.status === "completed" ? "Transcript ready" : `Status: ${res.status}`);
        refresh();
      } else toast.error(res.error);
    });
  }

  function onResummarize() {
    if (!transcript) return;
    start(async () => {
      const res = await regenerateCallNotes(transcript.id);
      if (res.ok) {
        toast.success("Notes updated");
        refresh();
      } else toast.error(res.error);
    });
  }

  function onDelete() {
    if (!transcript) return;
    if (!confirm("Delete this transcript?")) return;
    start(async () => {
      const res = await deleteTranscript(transcript.id);
      if (res.ok) {
        toast.success("Transcript deleted");
        setOpen(false);
        refresh();
      } else toast.error(res.error);
    });
  }

  function startEdit() {
    setDraft(transcript && transcript.segments.length ? segmentsToText(transcript.segments) : transcript?.text ?? "");
    setEditing(true);
  }

  function copyText() {
    const text = transcript ? (transcript.segments.length ? segmentsToText(transcript.segments) : transcript.text) : "";
    navigator.clipboard.writeText(text).then(() => toast.success("Copied"));
  }

  const ratio = transcript?.analysis?.talkRatioAgent;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={triggerVariant} size={triggerSize} className="gap-1.5">
          {status === "processing" ? <Loader2 className="size-3.5 animate-spin" /> : <FileText className="size-3.5" />}
          {label}
        </Button>
      </DialogTrigger>
      <DialogContent className="flex max-h-[92dvh] flex-col overflow-hidden sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Call transcript
            {transcript && (
              <Badge variant={status === "completed" ? "secondary" : status === "failed" ? "destructive" : "outline"}>
                {STATUS_LABEL[transcript.status]}
              </Badge>
            )}
          </DialogTitle>
          <DialogDescription>
            {transcript?.source === "manual"
              ? "Entered manually."
              : transcript
                ? `Source: ${transcript.source.replace(/_/g, " ")}.`
                : "No transcript yet — paste one below, or it'll fill in automatically once a recording is transcribed."}
          </DialogDescription>
        </DialogHeader>

        {/* Recording player */}
        {rec && (
          <audio controls preload="none" src={`/api/twilio/recording/${rec}`} className="h-9 w-full" />
        )}

        {/* Auto call notes — the rep's notes, written from the transcript */}
        {transcript?.analysis?.summary && !editing && (
          <div className="rounded-md border border-l-4 border-l-primary bg-muted/40 px-3 py-2">
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <Sparkles className="size-3.5" /> Auto call notes
              </span>
              <button
                type="button"
                onClick={onResummarize}
                disabled={pending}
                className="text-[11px] text-primary hover:underline disabled:opacity-50"
              >
                Re-summarize
              </button>
            </div>
            <p className="text-sm leading-snug">{transcript.analysis.summary}</p>
            {!!transcript.analysis.bullets?.length && (
              <ul className="mt-1.5 list-disc space-y-0.5 pl-4 text-[13px] leading-snug">
                {transcript.analysis.bullets.map((b, i) => (
                  <li key={i}>{b}</li>
                ))}
              </ul>
            )}
            {transcript.analysis.nextStep && (
              <p className="mt-1.5 text-[13px]">
                <span className="font-medium">Next:</span> {transcript.analysis.nextStep}
              </p>
            )}
          </div>
        )}

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
          {editing ? (
            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={12}
              placeholder={"Agent: Hi, this is…\nProspect: Hello…\n\nPrefix lines with Agent: / Prospect: to label speakers."}
              className="font-mono text-xs"
            />
          ) : hasText ? (
            <>
              {ratio != null && (
                <p className="mb-2 text-xs text-muted-foreground">
                  You spoke {Math.round(ratio * 100)}% of the words.
                </p>
              )}
              <TranscriptView segments={transcript!.segments} />
            </>
          ) : status === "processing" ? (
            <div className="flex flex-col items-center gap-2 py-10 text-sm text-muted-foreground">
              <Loader2 className="size-5 animate-spin" />
              Transcribing this call… check back shortly.
            </div>
          ) : (
            <div className="py-8 text-center text-sm text-muted-foreground">
              {transcript?.error ? `Last error: ${transcript.error}` : "No transcript text yet."}
            </div>
          )}
        </div>

        {/* Controls */}
        <div className="flex flex-wrap items-center gap-2 border-t pt-3">
          {editing ? (
            <>
              <Button size="sm" onClick={onSaveManual} disabled={pending || !draft.trim()}>
                Save
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={pending}>
                Cancel
              </Button>
            </>
          ) : (
            <>
              {hasText && (
                <Button size="sm" variant="outline" onClick={copyText}>
                  <Copy className="size-3.5" /> Copy
                </Button>
              )}
              {rec && (
                <Button size="sm" variant="outline" asChild>
                  <a href={`/api/twilio/recording/${rec}?dl=1`} download>
                    <Download className="size-3.5" /> Audio
                  </a>
                </Button>
              )}
              {hasText && (
                <div className="flex items-center gap-1">
                  {(["txt", "json", "vtt"] as const).map((fmt) => (
                    <Button key={fmt} size="sm" variant="outline" asChild>
                      <a href={`/api/transcripts/${transcript!.id}?format=${fmt}`} download>
                        <Download className="size-3.5" /> {fmt.toUpperCase()}
                      </a>
                    </Button>
                  ))}
                </div>
              )}
              {/* Auto engine controls */}
              {transcript && engineConfigured && rec && status !== "processing" && !hasText && (
                <Button size="sm" onClick={onGenerate} disabled={pending}>
                  <Sparkles className="size-3.5" /> Transcribe
                </Button>
              )}
              {transcript && status === "processing" && (
                <Button size="sm" variant="outline" onClick={onRefresh} disabled={pending}>
                  <RefreshCw className="size-3.5" /> Refresh
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={startEdit} disabled={pending}>
                <Pencil className="size-3.5" /> {hasText ? "Edit" : "Enter manually"}
              </Button>
              <div className="ml-auto">
                {transcript && (
                  <Button size="sm" variant="ghost" className="text-muted-foreground hover:text-destructive" onClick={onDelete} disabled={pending}>
                    <Trash2 className="size-3.5" />
                  </Button>
                )}
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
