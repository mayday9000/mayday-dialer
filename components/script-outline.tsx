"use client";

import { useEffect, useState, type RefObject } from "react";
import { cn } from "@/lib/utils";
import type { OutlineItem } from "@/lib/script-outline";
import { List } from "lucide-react";

/** Smooth-scroll a heading (by anchor id) to the top of its scroll container. */
function scrollToId(container: HTMLElement | null, id: string) {
  const el = container?.querySelector<HTMLElement>(`[id="${CSS.escape(id)}"]`);
  el?.scrollIntoView({ behavior: "smooth", block: "start" });
}

/**
 * Scroll-spy: which heading the reader is currently on. Biased toward the top of
 * the viewport so the active item is the section you're reading, not the next
 * one peeking in at the bottom.
 */
function useActiveHeading(
  containerRef: RefObject<HTMLElement | null>,
  items: OutlineItem[],
): string | null {
  const [active, setActive] = useState<string | null>(items[0]?.id ?? null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || items.length === 0) return;

    const headings = items
      .map((i) => container.querySelector<HTMLElement>(`[id="${CSS.escape(i.id)}"]`))
      .filter((el): el is HTMLElement => el != null);
    if (headings.length === 0) return;

    const onScroll = () => {
      // The active section is the last heading whose top has crossed a line a
      // little below the container's top edge.
      const line = container.getBoundingClientRect().top + 96;
      let current = headings[0].id;
      for (const h of headings) {
        if (h.getBoundingClientRect().top <= line) current = h.id;
        else break;
      }
      setActive(current);
    };

    onScroll();
    container.addEventListener("scroll", onScroll, { passive: true });
    return () => container.removeEventListener("scroll", onScroll);
  }, [containerRef, items]);

  return active;
}

/** Smallest heading level present — so the outline docks flush-left regardless
 * of whether a script starts at `#`, `##`, or `###`. */
function baseLevel(items: OutlineItem[]): number {
  return items.reduce((min, i) => Math.min(min, i.level), 6);
}

/** Desktop: a Google-Docs-style outline rail beside the script. */
export function ScriptOutlineRail({
  items,
  containerRef,
  className,
}: {
  items: OutlineItem[];
  containerRef: RefObject<HTMLElement | null>;
  className?: string;
}) {
  const active = useActiveHeading(containerRef, items);
  const base = baseLevel(items);

  return (
    <nav className={cn("text-sm", className)} aria-label="Script sections">
      <div className="flex items-center gap-1.5 px-2 pb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        <List className="size-3.5" />
        Sections
      </div>
      <ul className="space-y-0.5">
        {items.map((it) => (
          <li key={it.id}>
            <button
              type="button"
              onClick={() => scrollToId(containerRef.current, it.id)}
              style={{ paddingLeft: `${(it.level - base) * 12 + 8}px` }}
              className={cn(
                "block w-full truncate rounded py-1 pr-2 text-left leading-snug transition-colors hover:bg-accent hover:text-foreground",
                it.level <= base ? "font-medium" : "text-[13px]",
                active === it.id
                  ? "bg-accent font-medium text-foreground"
                  : "text-muted-foreground",
              )}
              title={it.label}
            >
              {it.label}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** Mobile: a compact "Jump to section" dropdown pinned above the script. */
export function ScriptJump({
  items,
  containerRef,
  className,
}: {
  items: OutlineItem[];
  containerRef: RefObject<HTMLElement | null>;
  className?: string;
}) {
  const active = useActiveHeading(containerRef, items);
  const base = baseLevel(items);

  return (
    <label className={cn("flex items-center gap-2 text-xs text-muted-foreground", className)}>
      <List className="size-4 shrink-0" />
      <span className="sr-only">Jump to section</span>
      <select
        value={active ?? ""}
        onChange={(e) => scrollToId(containerRef.current, e.target.value)}
        className="min-w-0 flex-1 rounded-md border bg-background px-2 py-1.5 text-sm text-foreground"
      >
        {items.map((it) => (
          <option key={it.id} value={it.id}>
            {"  ".repeat(Math.max(0, it.level - base)) + it.label}
          </option>
        ))}
      </select>
    </label>
  );
}
