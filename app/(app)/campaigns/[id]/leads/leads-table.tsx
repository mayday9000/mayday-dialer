"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowUp, ArrowDown, Clock, Star, Globe, Mail, Users } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { LeadStatusBadge } from "@/components/lead-status-badge";
import { RemoveLeadButton } from "../campaign-detail-client";
import { formatPhone } from "@/lib/phone";
import { leadTimezone } from "@/lib/compliance";
import { openStateFromHours, type OpenState } from "@/lib/hours";
import { outcomeLabel } from "@/lib/dial";
import { cn } from "@/lib/utils";
import type { LeadEnrichment, LeadStatus } from "@/lib/db/schema";
import { LeadsToolbar, type HoursFilter } from "./leads-toolbar";

/** The lead shape the server page hands to the client table. */
export type TableLead = {
  id: string;
  companyName: string | null;
  contactName: string | null;
  title: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  status: LeadStatus;
  archived: boolean;
  source: string | null;
  marketId: string | null;
  city: string | null;
  customFields: Record<string, string> | null;
  enrichment: LeadEnrichment | null;
  ownerName: string | null;
  createdAt: string; // ISO
  lastCallAt: string | null; // ISO
  lastCallOutcome: string | null;
};

type SortKey =
  | "company"
  | "contact"
  | "status"
  | "hours"
  | "rating"
  | "city"
  | "lastCalled"
  | "created";

type Dir = "asc" | "desc";

// Open → closed → unknown, for the office-hours sort.
const OPEN_RANK: Record<OpenState, number> = { open: 0, closed: 1, unknown: 2 };

function ratingOf(l: TableLead): number | null {
  const raw = l.enrichment?.rating?.value;
  if (!raw) return null;
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : null;
}

const cmp = (a: string | null, b: string | null) =>
  (a ?? "").localeCompare(b ?? "", undefined, { sensitivity: "base" });

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function hhmmLabel(hhmm: string): string {
  const n = parseInt(hhmm, 10);
  if (!Number.isFinite(n)) return hhmm;
  let h = Math.floor(n / 100);
  const m = n % 100;
  const ap = h >= 12 ? "p" : "a";
  h = h % 12;
  if (h === 0) h = 12;
  return m === 0 ? `${h}${ap}` : `${h}:${String(m).padStart(2, "0")}${ap}`;
}

/** Today's open/close text for the lead in its own timezone, e.g. "9a–5p today". */
function todayHoursText(l: TableLead, tz: string | null, nowMs: number): string | null {
  const periods = l.enrichment?.officeHours?.periods;
  if (!periods || !periods.length) return null;
  let weekday: number;
  try {
    const wd = new Intl.DateTimeFormat("en-US", {
      timeZone: tz ?? undefined,
      weekday: "short",
    }).format(new Date(nowMs));
    weekday = DAY_NAMES.indexOf(wd);
  } catch {
    weekday = new Date(nowMs).getDay();
  }
  if (weekday < 0) return null;
  const todays = periods.filter((p) => p.day === weekday);
  if (!todays.length) return "Closed today";
  return todays.map((p) => `${hhmmLabel(p.open)}–${hhmmLabel(p.close)}`).join(", ") + " today";
}

function OpenStateBadge({ state }: { state: OpenState }) {
  const styles: Record<OpenState, string> = {
    open: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300",
    closed: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
    unknown: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
  };
  const label = state === "open" ? "Open" : state === "closed" ? "Closed" : "Unknown";
  return (
    <Badge variant="secondary" className={cn("border-transparent font-medium", styles[state])}>
      <Clock className="size-3" />
      {label}
    </Badge>
  );
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function fmtRelative(iso: string | null, nowMs: number): string {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "—";
  const diff = nowMs - t;
  const day = 86_400_000;
  if (diff < 0) return "just now";
  if (diff < 3_600_000) return `${Math.max(1, Math.round(diff / 60_000))}m ago`;
  if (diff < day) return `${Math.round(diff / 3_600_000)}h ago`;
  if (diff < 30 * day) return `${Math.round(diff / day)}d ago`;
  return fmtDate(iso);
}

export function LeadsTable({
  campaignId,
  leads,
  markets = [],
}: {
  campaignId: string;
  leads: TableLead[];
  markets?: { id: string; name: string }[];
}) {
  // Lint-safe "now": useState initializer keeps Date.now() out of render.
  const [now] = useState(() => Date.now());

  // --- Filters ------------------------------------------------------------
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<LeadStatus | "all">("all");
  const [city, setCity] = useState<string>("all"); // "all" or a market id
  const [hoursFilter, setHoursFilter] = useState<HoursFilter>("all");
  const [hasContact, setHasContact] = useState(false);
  const [hasWebsite, setHasWebsite] = useState(false);
  // Discarded/rejected leads are hidden by default — they're out of the working
  // list. Toggle on to review (and restore) them.
  const [showDiscarded, setShowDiscarded] = useState(false);

  // --- Sort ---------------------------------------------------------------
  const [sortKey, setSortKey] = useState<SortKey>("company");
  const [dir, setDir] = useState<Dir>("asc");

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setDir("asc");
    }
  }

  // Open-state per lead, computed once for the current `now`.
  const openStates = useMemo(() => {
    const m = new Map<string, OpenState>();
    for (const l of leads) {
      const tz = leadTimezone({ phone: l.phone, customFields: l.customFields });
      m.set(l.id, openStateFromHours(l.enrichment?.officeHours?.periods, tz, now));
    }
    return m;
  }, [leads, now]);

  const view = useMemo(() => {
    const q = query.trim().toLowerCase();
    let rows = leads.filter((l) => {
      if (!showDiscarded && l.archived) return false; // hide discarded/rejected by default
      if (status !== "all" && l.status !== status) return false;
      if (city !== "all" && l.marketId !== city) return false;
      if (hasContact && !l.contactName) return false;
      if (hasWebsite && !l.website) return false;

      const state = openStates.get(l.id) ?? "unknown";
      const hasHours = !!l.enrichment?.officeHours?.periods?.length;
      if (hoursFilter === "open" && state !== "open") return false;
      if (hoursFilter === "closed" && state !== "closed") return false;
      if (hoursFilter === "has" && !hasHours) return false;
      if (hoursFilter === "unknown" && hasHours) return false;

      if (q) {
        const hay = [l.companyName, l.contactName, l.phone, l.email]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    const sign = dir === "asc" ? 1 : -1;
    rows = [...rows].sort((a, b) => {
      let r = 0;
      switch (sortKey) {
        case "company":
          r = cmp(a.companyName, b.companyName);
          break;
        case "contact":
          r = cmp(a.contactName, b.contactName);
          break;
        case "status":
          r = cmp(a.status, b.status);
          break;
        case "city":
          r = cmp(a.city, b.city);
          break;
        case "rating": {
          const ra = ratingOf(a);
          const rb = ratingOf(b);
          // Missing ratings sort last regardless of direction.
          if (ra == null && rb == null) r = 0;
          else if (ra == null) return 1;
          else if (rb == null) return -1;
          else r = ra - rb;
          break;
        }
        case "hours": {
          const sa = OPEN_RANK[openStates.get(a.id) ?? "unknown"];
          const sb = OPEN_RANK[openStates.get(b.id) ?? "unknown"];
          r = sa - sb;
          break;
        }
        case "lastCalled": {
          const ta = a.lastCallAt ? new Date(a.lastCallAt).getTime() : null;
          const tb = b.lastCallAt ? new Date(b.lastCallAt).getTime() : null;
          if (ta == null && tb == null) r = 0;
          else if (ta == null) return 1; // never-called sort last
          else if (tb == null) return -1;
          else r = ta - tb;
          break;
        }
        case "created":
          r = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
          break;
      }
      if (r === 0) r = cmp(a.companyName, b.companyName); // stable tie-break
      return r * sign;
    });
    return rows;
  }, [leads, query, status, city, hoursFilter, hasContact, hasWebsite, showDiscarded, openStates, sortKey, dir]);

  const discardedCount = useMemo(() => leads.filter((l) => l.archived).length, [leads]);
  const denom = showDiscarded ? leads.length : leads.length - discardedCount;

  const filtered =
    !!query.trim() ||
    status !== "all" ||
    city !== "all" ||
    hoursFilter !== "all" ||
    hasContact ||
    hasWebsite;

  function clearFilters() {
    setQuery("");
    setStatus("all");
    setCity("all");
    setHoursFilter("all");
    setHasContact(false);
    setHasWebsite(false);
  }

  const sortHead = (label: string, key: SortKey, className?: string) => (
    <TableHead className={className}>
      <button
        type="button"
        onClick={() => toggleSort(key)}
        className="inline-flex items-center gap-1 hover:text-foreground"
      >
        {label}
        {sortKey === key &&
          (dir === "asc" ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />)}
      </button>
    </TableHead>
  );

  return (
    <div className="space-y-4">
      <LeadsToolbar
        query={query}
        onQueryChange={setQuery}
        status={status}
        onStatusChange={setStatus}
        markets={markets}
        city={city}
        onCityChange={setCity}
        hoursFilter={hoursFilter}
        onHoursFilterChange={setHoursFilter}
        hasContact={hasContact}
        onHasContactChange={setHasContact}
        hasWebsite={hasWebsite}
        onHasWebsiteChange={setHasWebsite}
        showDiscarded={showDiscarded}
        onShowDiscardedChange={setShowDiscarded}
        discardedCount={discardedCount}
      />

      <p className="text-xs text-muted-foreground">
        Showing {view.length} of {denom} lead{denom === 1 ? "" : "s"}
        {!showDiscarded && discardedCount > 0 && ` · ${discardedCount} discarded hidden`}
      </p>

      {view.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed py-16 text-center">
          <Users className="size-8 text-muted-foreground" />
          <div className="text-sm text-muted-foreground">
            {filtered ? "No leads match your filters." : "No leads yet."}
          </div>
          {filtered && (
            <Button variant="outline" size="sm" onClick={clearFilters}>
              Clear filters
            </Button>
          )}
        </div>
      ) : (
        <>
          {/* Mobile: compact stacked cards (fewer fields). */}
          <div className="space-y-3 md:hidden">
            {view.map((l) => {
              const state = openStates.get(l.id) ?? "unknown";
              return (
                <Card key={l.id} size="sm" className={cn(l.archived && "opacity-60")}>
                  <CardContent className="flex items-start justify-between gap-3">
                    <Link href={`/leads/${l.id}`} className="min-w-0 hover:underline">
                      <div className="truncate font-medium">{l.companyName || "—"}</div>
                      {l.contactName && (
                        <div className="truncate text-sm text-muted-foreground">
                          {l.contactName}
                        </div>
                      )}
                      {l.phone && (
                        <div className="mt-1 text-sm tabular-nums text-muted-foreground">
                          {formatPhone(l.phone)}
                        </div>
                      )}
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <LeadStatusBadge status={l.status} archived={l.archived} />
                        <OpenStateBadge state={state} />
                      </div>
                    </Link>
                    <div className="flex shrink-0 flex-col items-end gap-2">
                      <RemoveLeadButton campaignId={campaignId} leadId={l.id} />
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {/* Desktop: wide, sortable table (scrolls horizontally). */}
          <div className="hidden rounded-md border md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  {sortHead("Company", "company")}
                  {sortHead("Contact", "contact")}
                  <TableHead>Title</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Website</TableHead>
                  {sortHead("Status", "status")}
                  {sortHead("Office hours", "hours")}
                  {sortHead("Rating", "rating")}
                  {sortHead("City", "city")}
                  <TableHead>Source</TableHead>
                  {sortHead("Last called", "lastCalled")}
                  <TableHead>Owner</TableHead>
                  {sortHead("Created", "created")}
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {view.map((l) => {
                  const state = openStates.get(l.id) ?? "unknown";
                  const tz = leadTimezone({ phone: l.phone, customFields: l.customFields });
                  const hoursText = todayHoursText(l, tz, now);
                  const rating = ratingOf(l);
                  let host: string | null = null;
                  if (l.website) {
                    try {
                      host = new URL(
                        l.website.startsWith("http") ? l.website : `https://${l.website}`,
                      ).hostname.replace(/^www\./, "");
                    } catch {
                      host = l.website;
                    }
                  }
                  return (
                    <TableRow key={l.id} className={cn(l.archived && "opacity-60")}>
                      <TableCell className="font-medium">
                        <Link href={`/leads/${l.id}`} className="hover:underline">
                          {l.companyName || "—"}
                        </Link>
                      </TableCell>
                      <TableCell>{l.contactName || "—"}</TableCell>
                      <TableCell className="text-muted-foreground">{l.title || "—"}</TableCell>
                      <TableCell className="tabular-nums">
                        {l.phone ? formatPhone(l.phone) : "—"}
                      </TableCell>
                      <TableCell>
                        {l.email ? (
                          <a
                            href={`mailto:${l.email}`}
                            className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground hover:underline"
                          >
                            <Mail className="size-3.5" />
                            <span className="max-w-[14rem] truncate">{l.email}</span>
                          </a>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      <TableCell>
                        {host ? (
                          <a
                            href={l.website!.startsWith("http") ? l.website! : `https://${l.website}`}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground hover:underline"
                          >
                            <Globe className="size-3.5" />
                            <span className="max-w-[12rem] truncate">{host}</span>
                          </a>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      <TableCell>
                        <LeadStatusBadge status={l.status} archived={l.archived} />
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <OpenStateBadge state={state} />
                          {hoursText && (
                            <span
                              className="text-xs text-muted-foreground"
                              title={l.enrichment?.officeHours?.value ?? undefined}
                            >
                              {hoursText}
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {rating != null ? (
                          <span className="inline-flex items-center gap-1">
                            <Star className="size-3.5 fill-amber-400 text-amber-400" />
                            {rating.toFixed(1)}
                          </span>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      <TableCell>{l.city || "—"}</TableCell>
                      <TableCell className="text-muted-foreground">{l.source || "—"}</TableCell>
                      <TableCell
                        className="text-muted-foreground"
                        title={
                          l.lastCallOutcome ? outcomeLabel(l.lastCallOutcome) : undefined
                        }
                      >
                        {fmtRelative(l.lastCallAt, now)}
                      </TableCell>
                      <TableCell>{l.ownerName || "—"}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {fmtDate(l.createdAt)}
                      </TableCell>
                      <TableCell>
                        <RemoveLeadButton campaignId={campaignId} leadId={l.id} />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </div>
  );
}
