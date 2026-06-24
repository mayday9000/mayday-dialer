/** Speaker-separated transcript bubbles. Pure/presentational. */
import { SPEAKER_LABEL } from "@/lib/transcripts";
import type { TranscriptSegment } from "@/lib/db/schema";
import { cn } from "@/lib/utils";

function fmtClock(ms: number): string {
  const t = Math.floor(ms / 1000);
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
}

export function TranscriptView({ segments }: { segments: TranscriptSegment[] }) {
  if (!segments.length) {
    return <p className="py-4 text-center text-sm text-muted-foreground">No transcript text.</p>;
  }
  return (
    <div className="space-y-2.5">
      {segments.map((s, i) => {
        const agent = s.speaker === "agent";
        return (
          <div key={i} className={cn("flex flex-col gap-0.5", agent ? "items-end" : "items-start")}>
            <span className="px-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              {SPEAKER_LABEL[s.speaker]}
              {s.startMs != null ? ` · ${fmtClock(s.startMs)}` : ""}
            </span>
            <div
              className={cn(
                "max-w-[85%] rounded-2xl px-3 py-2 text-sm",
                agent ? "rounded-br-sm bg-primary text-primary-foreground" : "rounded-bl-sm bg-muted",
              )}
            >
              {s.text}
            </div>
          </div>
        );
      })}
    </div>
  );
}
