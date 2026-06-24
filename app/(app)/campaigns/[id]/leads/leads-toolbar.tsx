"use client";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { LEAD_STATUSES, type LeadStatus } from "@/lib/db/schema";
import { leadStatusLabel } from "@/components/lead-status-badge";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";

export type HoursFilter = "all" | "open" | "closed" | "has" | "unknown";

const HOURS_OPTIONS: { value: HoursFilter; label: string }[] = [
  { value: "all", label: "All hours" },
  { value: "open", label: "Open now" },
  { value: "closed", label: "Closed now" },
  { value: "has", label: "Has hours" },
  { value: "unknown", label: "Unknown hours" },
];

function Toggle({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Button
      type="button"
      variant={active ? "default" : "outline"}
      size="sm"
      aria-pressed={active}
      onClick={onClick}
      className={cn(!active && "text-muted-foreground")}
    >
      {children}
    </Button>
  );
}

export function LeadsToolbar({
  query,
  onQueryChange,
  status,
  onStatusChange,
  markets = [],
  city,
  onCityChange,
  hoursFilter,
  onHoursFilterChange,
  hasContact,
  onHasContactChange,
  hasWebsite,
  onHasWebsiteChange,
  showDiscarded,
  onShowDiscardedChange,
  discardedCount,
}: {
  query: string;
  onQueryChange: (v: string) => void;
  status: LeadStatus | "all";
  onStatusChange: (v: LeadStatus | "all") => void;
  markets?: { id: string; name: string }[];
  city: string;
  onCityChange: (v: string) => void;
  hoursFilter: HoursFilter;
  onHoursFilterChange: (v: HoursFilter) => void;
  hasContact: boolean;
  onHasContactChange: (v: boolean) => void;
  hasWebsite: boolean;
  onHasWebsiteChange: (v: boolean) => void;
  showDiscarded: boolean;
  onShowDiscardedChange: (v: boolean) => void;
  discardedCount: number;
}) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
      <div className="relative w-full sm:w-64">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Search company, contact, phone, email…"
          className="w-full pl-8"
        />
      </div>

      <Select value={status} onValueChange={(v) => onStatusChange(v as LeadStatus | "all")}>
        <SelectTrigger className="w-full sm:w-44">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All statuses</SelectItem>
          {LEAD_STATUSES.map((s) => (
            <SelectItem key={s} value={s}>
              {leadStatusLabel(s)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {markets.length > 1 && (
        <Select value={city} onValueChange={onCityChange}>
          <SelectTrigger className="w-full sm:w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All cities</SelectItem>
            {markets.map((m) => (
              <SelectItem key={m.id} value={m.id}>
                {m.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      <Select value={hoursFilter} onValueChange={(v) => onHoursFilterChange(v as HoursFilter)}>
        <SelectTrigger className="w-full sm:w-44">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {HOURS_OPTIONS.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Toggle active={hasContact} onClick={() => onHasContactChange(!hasContact)}>
        Has contact
      </Toggle>
      <Toggle active={hasWebsite} onClick={() => onHasWebsiteChange(!hasWebsite)}>
        Has website
      </Toggle>
      {discardedCount > 0 && (
        <Toggle active={showDiscarded} onClick={() => onShowDiscardedChange(!showDiscarded)}>
          Show discarded ({discardedCount})
        </Toggle>
      )}
    </div>
  );
}
