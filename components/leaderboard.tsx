"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { Trophy, Medal } from "lucide-react";
import { fmtDuration } from "@/components/today-stats";
import type { LeaderRow } from "@/lib/stats";

const MEDAL = ["text-amber-500", "text-zinc-400", "text-amber-700"]; // 🥇🥈🥉

export function Leaderboard({
  ranges,
  currentUserId,
}: {
  ranges: { key: string; label: string; rows: LeaderRow[] }[];
  currentUserId: string;
}) {
  const [active, setActive] = useState(ranges[0]?.key ?? "");
  const rows = (ranges.find((r) => r.key === active)?.rows ?? []).filter((r) => r.dials > 0);

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="flex items-center gap-2 text-base">
          <Trophy className="size-4 text-amber-500" />
          Leaderboard
        </CardTitle>
        <div className="flex gap-0.5 rounded-md bg-muted p-0.5 text-xs">
          {ranges.map((r) => (
            <button
              key={r.key}
              type="button"
              onClick={() => setActive(r.key)}
              className={cn(
                "rounded px-2 py-1 transition-colors",
                active === r.key
                  ? "bg-background font-medium shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {r.label}
            </button>
          ))}
        </div>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No calls in this window yet — be the first on the board.
          </p>
        ) : (
          <div className="space-y-1">
            <div className="grid grid-cols-[1.75rem_1fr_2.75rem_2.75rem_2.75rem_3.25rem] gap-2 px-2 pb-1 text-[11px] uppercase tracking-wide text-muted-foreground">
              <div>#</div>
              <div>Rep</div>
              <div className="text-right">Dials</div>
              <div className="text-right">Convo</div>
              <div className="text-right">Booked</div>
              <div className="text-right">Talk</div>
            </div>
            {rows.length > 1 && (
              <div className="grid grid-cols-[1.75rem_1fr_2.75rem_2.75rem_2.75rem_3.25rem] items-center gap-2 rounded-md border border-primary/20 bg-primary/5 px-2 py-2 text-sm font-semibold">
                <div className="flex justify-center">
                  <Trophy className="size-4 text-primary" />
                </div>
                <div className="min-w-0 truncate">Mayday AI</div>
                <div className="text-right tabular-nums">
                  {rows.reduce((n, r) => n + r.dials, 0)}
                </div>
                <div className="text-right tabular-nums">
                  {rows.reduce((n, r) => n + r.conversations, 0)}
                </div>
                <div className="text-right tabular-nums">
                  {rows.reduce((n, r) => n + r.booked, 0)}
                </div>
                <div className="text-right tabular-nums text-muted-foreground">
                  {fmtDuration(rows.reduce((n, r) => n + r.talkSec, 0))}
                </div>
              </div>
            )}
            {rows.map((r, i) => {
              const me = r.userId === currentUserId;
              return (
                <div
                  key={r.userId}
                  className={cn(
                    "grid grid-cols-[1.75rem_1fr_2.75rem_2.75rem_2.75rem_3.25rem] items-center gap-2 rounded-md px-2 py-2 text-sm",
                    me ? "bg-primary/10 ring-1 ring-primary/20" : "odd:bg-muted/30",
                  )}
                >
                  <div className="flex justify-center tabular-nums">
                    {i < 3 ? (
                      <Medal className={cn("size-4", MEDAL[i])} />
                    ) : (
                      <span className="text-muted-foreground">{i + 1}</span>
                    )}
                  </div>
                  <div className="min-w-0 truncate font-medium">
                    {r.name}
                    {me && <span className="ml-1 text-xs font-normal text-primary">you</span>}
                  </div>
                  <div className="text-right tabular-nums">{r.dials}</div>
                  <div className="text-right tabular-nums">{r.conversations}</div>
                  <div className="text-right font-semibold tabular-nums">{r.booked}</div>
                  <div className="text-right tabular-nums text-muted-foreground">
                    {fmtDuration(r.talkSec)}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
