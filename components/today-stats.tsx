/**
 * Presentational stat pieces for the Today dashboard. All server-renderable
 * (no client state) — they just take numbers and draw. Charts are pure CSS
 * (flexbox + percentage heights), so no charting dependency.
 */
import { cn } from "@/lib/utils";
import { ArrowDown, ArrowUp, Minus } from "lucide-react";
import type { DayBucket } from "@/lib/stats";

type Tone = "default" | "good" | "neutral" | "bad";

const toneIcon: Record<Tone, string> = {
  default: "text-muted-foreground",
  good: "text-emerald-500",
  neutral: "text-amber-500",
  bad: "text-rose-500",
};

export function fmtDuration(sec: number): string {
  if (!sec || sec <= 0) return "0m";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export function pct(num: number, den: number): string {
  if (!den) return "—";
  return `${Math.round((num / den) * 100)}%`;
}

/** A single headline metric tile. */
export function StatTile({
  label,
  value,
  hint,
  icon: Icon,
  tone = "default",
  delta,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  icon?: React.ComponentType<{ className?: string }>;
  tone?: Tone;
  delta?: { now: number; prev: number };
}) {
  return (
    <div className="flex flex-col gap-1 rounded-xl bg-card px-4 py-3 ring-1 ring-foreground/10">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        {Icon && <Icon className={cn("size-4", toneIcon[tone])} />}
      </div>
      <div className="flex items-baseline gap-2">
        <span className="text-2xl font-semibold tabular-nums">{value}</span>
        {delta && <TrendBadge now={delta.now} prev={delta.prev} />}
      </div>
      {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}

/** Up/down/flat chip comparing two numbers (vs yesterday, vs prior week, …). */
export function TrendBadge({ now, prev }: { now: number; prev: number }) {
  if (prev === 0 && now === 0) return null;
  const diff = now - prev;
  const dir = diff > 0 ? "up" : diff < 0 ? "down" : "flat";
  const Icon = dir === "up" ? ArrowUp : dir === "down" ? ArrowDown : Minus;
  const color =
    dir === "up" ? "text-emerald-600" : dir === "down" ? "text-rose-600" : "text-muted-foreground";
  const label = prev === 0 ? "new" : `${diff > 0 ? "+" : ""}${Math.round((diff / prev) * 100)}%`;
  return (
    <span className={cn("inline-flex items-center gap-0.5 text-xs font-medium", color)}>
      <Icon className="size-3" />
      {label}
    </span>
  );
}

/** 7-day dials-per-day bars; the conversation share is shaded at each bar's base. */
export function ActivityChart({ days }: { days: DayBucket[] }) {
  const max = Math.max(1, ...days.map((d) => d.dials));
  return (
    <div className="flex h-32 items-end gap-2">
      {days.map((d, i) => {
        const isToday = i === days.length - 1;
        const barPct = d.dials === 0 ? 0 : Math.max(6, (d.dials / max) * 100);
        const convoFrac = d.dials === 0 ? 0 : d.conversations / d.dials;
        return (
          <div key={d.key} className="flex flex-1 flex-col items-center gap-1">
            <span className="text-[11px] font-medium tabular-nums text-muted-foreground">
              {d.dials || ""}
            </span>
            <div className="flex w-full flex-1 items-end">
              <div
                className={cn(
                  "flex w-full flex-col justify-end rounded-sm bg-muted transition-all",
                  isToday && "ring-1 ring-primary/40",
                )}
                style={{ height: `${barPct}%` }}
                title={`${d.dials} dials · ${d.conversations} conversations · ${d.booked} booked`}
              >
                <div
                  className="w-full rounded-sm bg-primary"
                  style={{ height: `${convoFrac * 100}%` }}
                />
              </div>
            </div>
            <span className={cn("text-[10px] text-muted-foreground", isToday && "font-semibold text-foreground")}>
              {isToday ? "Today" : d.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** A proportional funnel/coverage row: label, count, and a fill bar vs a base. */
export function MeterRow({
  label,
  value,
  base,
  suffix,
  tone = "primary",
}: {
  label: string;
  value: number;
  base: number;
  suffix?: string;
  tone?: "primary" | "emerald" | "amber";
}) {
  const fill = base > 0 ? Math.min(100, (value / base) * 100) : 0;
  const barColor =
    tone === "emerald" ? "bg-emerald-500" : tone === "amber" ? "bg-amber-500" : "bg-primary";
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium tabular-nums">
          {value.toLocaleString()}
          {suffix ? <span className="ml-1 text-xs text-muted-foreground">{suffix}</span> : null}
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div className={cn("h-full rounded-full", barColor)} style={{ width: `${fill}%` }} />
      </div>
    </div>
  );
}
