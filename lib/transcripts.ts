/**
 * Pure transcript helpers — formatting, parsing, and export. No DB or network,
 * so they're safe to import from server actions, the download route, and the
 * client viewer alike.
 */
import type { TranscriptSegment, TranscriptSpeaker } from "@/lib/db/schema";

export const SPEAKER_LABEL: Record<TranscriptSpeaker, string> = {
  agent: "Agent",
  prospect: "Prospect",
  unknown: "Speaker",
};

/** Map a speaker label (any casing, "you"/"me"/"rep") back to a canonical role. */
export function speakerFromLabel(raw: string): TranscriptSpeaker {
  const s = raw.trim().toLowerCase();
  if (["agent", "you", "me", "rep", "caller", "sales"].includes(s)) return "agent";
  if (["prospect", "them", "lead", "customer", "client", "contact"].includes(s)) return "prospect";
  return "unknown";
}

/** Segments → speaker-labeled plain text ("Agent: …\nProspect: …"). */
export function segmentsToText(segments: TranscriptSegment[]): string {
  return segments
    .map((s) => `${SPEAKER_LABEL[s.speaker]}: ${s.text.trim()}`)
    .join("\n");
}

/**
 * Parse pasted/edited text back into segments. Recognizes "Speaker: line"
 * prefixes; un-prefixed lines continue the previous speaker (or "unknown").
 */
export function parseTextToSegments(raw: string): TranscriptSegment[] {
  const out: TranscriptSegment[] = [];
  let current: TranscriptSpeaker = "unknown";
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const m = trimmed.match(/^([A-Za-z ]{2,20}):\s*(.*)$/);
    if (m) {
      current = speakerFromLabel(m[1]);
      const text = m[2].trim();
      if (text) out.push({ speaker: current, text });
    } else if (out.length && out[out.length - 1].speaker === current) {
      out[out.length - 1].text += ` ${trimmed}`;
    } else {
      out.push({ speaker: current, text: trimmed });
    }
  }
  return out;
}

function pad(n: number, width = 2): string {
  return String(n).padStart(width, "0");
}

/** ms → "HH:MM:SS.mmm" for WebVTT cue times. */
export function fmtVttTime(ms: number): string {
  const total = Math.max(0, Math.floor(ms));
  const h = Math.floor(total / 3_600_000);
  const m = Math.floor((total % 3_600_000) / 60_000);
  const s = Math.floor((total % 60_000) / 1000);
  const millis = total % 1000;
  return `${pad(h)}:${pad(m)}:${pad(s)}.${pad(millis, 3)}`;
}

/** Segments → WebVTT. Falls back to 3s synthetic cues when no timing exists. */
export function segmentsToVtt(segments: TranscriptSegment[]): string {
  const lines = ["WEBVTT", ""];
  segments.forEach((seg, i) => {
    const start = seg.startMs ?? i * 3000;
    const end = seg.endMs ?? start + 3000;
    lines.push(String(i + 1));
    lines.push(`${fmtVttTime(start)} --> ${fmtVttTime(end)}`);
    lines.push(`<v ${SPEAKER_LABEL[seg.speaker]}>${seg.text.trim()}`);
    lines.push("");
  });
  return lines.join("\n");
}

/** A safe, descriptive download filename stem (no extension). */
export function transcriptFilenameStem(opts: {
  company?: string | null;
  contact?: string | null;
  at?: Date | string | null;
}): string {
  const who = (opts.company || opts.contact || "call").replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "");
  const d = opts.at ? new Date(opts.at) : null;
  const date = d && !isNaN(d.getTime()) ? d.toISOString().slice(0, 10) : "transcript";
  return `${who || "call"}-${date}`;
}

/** Build the DB patch for a transcript row from an engine result. Shared by the
 *  recording callback and the generate/refresh actions so storage stays
 *  identical. `analysis` is recomputed from the new segments (talk ratio). */
export function transcriptPatchFromResult(result: {
  status: string;
  segments: TranscriptSegment[];
  text: string;
  language?: string | null;
  error?: string | null;
}) {
  const ratio = result.segments.length ? agentTalkRatio(result.segments) : null;
  return {
    status: result.status as "pending" | "processing" | "completed" | "failed",
    segments: result.segments,
    text: result.text,
    language: result.language ?? undefined,
    analysis: ratio == null ? {} : { talkRatioAgent: Math.round(ratio * 100) / 100 },
    error: result.error ?? null,
    updatedAt: new Date(),
  };
}

/** Share of words spoken by the agent (0..1), for talk-ratio coaching. */
export function agentTalkRatio(segments: TranscriptSegment[]): number | null {
  let agent = 0;
  let total = 0;
  for (const s of segments) {
    const words = s.text.trim().split(/\s+/).filter(Boolean).length;
    total += words;
    if (s.speaker === "agent") agent += words;
  }
  return total > 0 ? agent / total : null;
}
