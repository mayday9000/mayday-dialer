"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { HarvestStats } from "@/lib/db/schema";
import {
  createSearch,
  updateSearch,
  deleteSearch,
  toggleSearchActive,
  runHarvest,
  type SearchInput,
} from "./actions";
import { Plus, Play, Pencil, Trash2, Radar, AlertTriangle, MapPin } from "lucide-react";

export type SearchRow = {
  id: string;
  label: string;
  location: string;
  state: string | null;
  keywords: string | null;
  extraLocations: string[];
  radiusMeters: number;
  targetCampaignId: string | null;
  requireWebsite: boolean;
  requirePhone: boolean;
  minRating: number | null;
  minReviews: number | null;
  maxPerRun: number;
  customRules: string | null;
  minDialable: number;
  active: boolean;
  lastRunAt: string | null;
  lastStats: HarvestStats;
};

type Campaign = { id: string; name: string };

type FormState = {
  label: string;
  location: string;
  state: string;
  keywords: string;
  extraLocationsText: string;
  radiusMiles: string;
  targetCampaignId: string; // "none" = unset
  requireWebsite: boolean;
  requirePhone: boolean;
  minRating: string;
  minReviews: string;
  maxPerRun: string;
  minDialable: string;
  customRules: string;
  active: boolean;
};

const M_PER_MI = 1609;

function emptyForm(): FormState {
  return {
    label: "",
    location: "",
    state: "",
    keywords: "",
    extraLocationsText: "",
    radiusMiles: "25",
    targetCampaignId: "none",
    requireWebsite: false,
    requirePhone: true,
    minRating: "",
    minReviews: "",
    maxPerRun: "30",
    minDialable: "25",
    customRules: "",
    active: true,
  };
}

function fromRow(r: SearchRow): FormState {
  return {
    label: r.label,
    location: r.location,
    state: r.state ?? "",
    keywords: r.keywords ?? "",
    extraLocationsText: (r.extraLocations ?? []).join("\n"),
    radiusMiles: String(Math.round(r.radiusMeters / M_PER_MI)),
    targetCampaignId: r.targetCampaignId ?? "none",
    requireWebsite: r.requireWebsite,
    requirePhone: r.requirePhone,
    minRating: r.minRating != null ? String(r.minRating) : "",
    minReviews: r.minReviews != null ? String(r.minReviews) : "",
    maxPerRun: String(r.maxPerRun),
    minDialable: String(r.minDialable),
    customRules: r.customRules ?? "",
    active: r.active,
  };
}

function toInput(f: FormState): SearchInput {
  const num = (s: string) => {
    const n = Number(s);
    return s.trim() !== "" && !Number.isNaN(n) ? n : null;
  };
  return {
    label: f.label,
    location: f.location,
    state: f.state || null,
    keywords: f.keywords || null,
    extraLocations: f.extraLocationsText.split("\n").map((s) => s.trim()).filter(Boolean),
    radiusMeters: Math.round((num(f.radiusMiles) ?? 25) * M_PER_MI),
    targetCampaignId: f.targetCampaignId === "none" ? null : f.targetCampaignId,
    requireWebsite: f.requireWebsite,
    requirePhone: f.requirePhone,
    minRating: num(f.minRating),
    minReviews: num(f.minReviews),
    maxPerRun: num(f.maxPerRun) ?? 30,
    minDialable: num(f.minDialable) ?? 25,
    customRules: f.customRules || null,
    active: f.active,
  };
}

function Check({
  label,
  checked,
  onChange,
  hint,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  hint?: string;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 size-4 accent-primary"
      />
      <span>
        <span className="text-sm">{label}</span>
        {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
      </span>
    </label>
  );
}

function statBadges(s: HarvestStats) {
  const items: [string, number | undefined, string][] = [
    ["new", s.newCount, "bg-green-100 text-green-800 dark:bg-green-950/50 dark:text-green-300"],
    ["review", s.queued, "bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300"],
    ["dupe", s.dupes, ""],
    ["rejected", s.rejected, ""],
  ];
  return items.filter(([, n]) => (n ?? 0) > 0).map(([k, n, cls]) => (
    <Badge key={k} variant="secondary" className={cls}>
      {n} {k}
    </Badge>
  ));
}

export function LeadSourcesClient({
  searches,
  campaigns,
  placesOn,
  llmOn,
  pendingCount,
}: {
  searches: SearchRow[];
  campaigns: Campaign[];
  placesOn: boolean;
  llmOn: boolean;
  pendingCount: number;
}) {
  const [pending, startTransition] = useTransition();
  const [runningId, setRunningId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null); // null = creating
  const [form, setForm] = useState<FormState>(emptyForm());

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const campaignName = (id: string | null) =>
    id ? campaigns.find((c) => c.id === id)?.name ?? "—" : "—";

  function openNew() {
    setEditingId(null);
    setForm(emptyForm());
    setOpen(true);
  }
  function openEdit(r: SearchRow) {
    setEditingId(r.id);
    setForm(fromRow(r));
    setOpen(true);
  }

  function save() {
    const input = toInput(form);
    startTransition(async () => {
      const res = editingId ? await updateSearch(editingId, input) : await createSearch(input);
      if (res.ok) {
        toast.success(editingId ? "Lead source updated" : "Lead source created");
        setOpen(false);
      } else {
        toast.error(res.error);
      }
    });
  }

  function run(id: string) {
    setRunningId(id);
    runHarvest(id)
      .then((res) => {
        if (res.ok) {
          const s = res.stats;
          toast.success(
            `Found ${s.found ?? 0}: ${s.approved ?? 0} added, ${s.queued ?? 0} to review, ${s.rejected ?? 0} pruned, ${s.dupes ?? 0} dupes`,
          );
          if (s.errors?.length) toast.warning(s.errors[0]);
        } else {
          toast.error(res.error);
        }
      })
      .finally(() => setRunningId(null));
  }

  function onDelete(r: SearchRow) {
    if (!confirm(`Delete lead source "${r.label}"? Its harvested leads are kept.`)) return;
    startTransition(async () => {
      const res = await deleteSearch(r.id);
      if (res.ok) toast.success("Deleted");
      else toast.error(res.error);
    });
  }

  function setActive(r: SearchRow, active: boolean) {
    startTransition(async () => {
      const res = await toggleSearchActive(r.id, active);
      if (!res.ok) toast.error(res.error);
    });
  }

  return (
    <div className="space-y-4">
      {/* Source mode + compliance banner */}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Badge variant="secondary" className="gap-1">
          <Radar className="size-3" />
          Source: {placesOn ? "Google Places" : "OpenStreetMap (free)"}
        </Badge>
        <Badge variant="secondary">{llmOn ? "AI pruning on" : "AI pruning off (rules only)"}</Badge>
        <div className="ml-auto flex items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href="/admin/lead-sources/review">
              Review queue{pendingCount > 0 ? ` (${pendingCount})` : ""}
            </Link>
          </Button>
          <Button size="sm" onClick={openNew}>
            <Plus className="size-4" />
            New lead source
          </Button>
        </div>
      </div>

      <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
        <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
        Harvested numbers are NOT scrubbed against the Do-Not-Call registry. Scrub before dialing — that stays your responsibility.
      </div>

      {searches.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed py-16 text-center">
          <Radar className="size-8 text-muted-foreground" />
          <div className="text-sm text-muted-foreground">No lead sources yet.</div>
          <Button variant="outline" size="sm" onClick={openNew}>
            <Plus className="size-4" />
            New lead source
          </Button>
        </div>
      ) : (
        <div className="grid gap-3">
          {searches.map((r) => (
            <Card key={r.id}>
              <CardContent className="flex flex-wrap items-center gap-x-4 gap-y-2 py-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{r.label}</span>
                    {!r.active && <Badge variant="outline">paused</Badge>}
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <MapPin className="size-3" />
                      {r.location}
                      {r.extraLocations.length > 0 && ` +${r.extraLocations.length}`}
                    </span>
                    <span>→ {campaignName(r.targetCampaignId)}</span>
                    {r.lastRunAt && <span>last run {new Date(r.lastRunAt).toLocaleString()}</span>}
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">{statBadges(r.lastStats)}</div>
                </div>
                <div className="flex items-center gap-1">
                  <Check label="" checked={r.active} onChange={(v) => setActive(r, v)} />
                  <Button size="sm" onClick={() => run(r.id)} disabled={runningId === r.id || pending}>
                    <Play className="size-4" />
                    {runningId === r.id ? "Running…" : "Run now"}
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => openEdit(r)} disabled={pending}>
                    <Pencil className="size-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-muted-foreground hover:text-destructive"
                    onClick={() => onDelete(r)}
                    disabled={pending}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Lead Settings popup */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit lead source" : "New lead source"}</DialogTitle>
            <DialogDescription>
              Where and how to find new leads. {placesOn ? "Using Google Places." : "Using free OpenStreetMap data."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Name</Label>
                <Input value={form.label} onChange={(e) => set("label", e.target.value)} placeholder="Springfield PM" />
              </div>
              <div className="space-y-1.5">
                <Label>Search term</Label>
                <Input value={form.keywords} onChange={(e) => set("keywords", e.target.value)} placeholder="property management" />
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-[1fr_120px_120px]">
              <div className="space-y-1.5">
                <Label>Region / city</Label>
                <Input value={form.location} onChange={(e) => set("location", e.target.value)} placeholder="Springfield, IL" />
              </div>
              <div className="space-y-1.5">
                <Label>State</Label>
                <Input value={form.state} onChange={(e) => set("state", e.target.value)} placeholder="IL" />
              </div>
              <div className="space-y-1.5">
                <Label>Radius (mi)</Label>
                <Input type="number" min={1} max={25} value={form.radiusMiles} onChange={(e) => set("radiusMiles", e.target.value)} />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Extra areas (one per line)</Label>
              <Textarea
                rows={2}
                value={form.extraLocationsText}
                onChange={(e) => set("extraLocationsText", e.target.value)}
                placeholder={"Naperville, IL\nAurora, IL\nKenosha, WI"}
              />
            </div>

            <div className="space-y-1.5">
              <Label>Add to campaign</Label>
              <Select value={form.targetCampaignId} onValueChange={(v) => set("targetCampaignId", v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No campaign (pool only)</SelectItem>
                  {campaigns.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-3 rounded-md border p-3 sm:grid-cols-2">
              <Check label="Must have a phone" checked={form.requirePhone} onChange={(v) => set("requirePhone", v)} />
              <Check label="Must have a website" checked={form.requireWebsite} onChange={(v) => set("requireWebsite", v)} hint="Tries to find one; drops it if none." />
              <div className="space-y-1.5">
                <Label>Min rating</Label>
                <Input type="number" step="0.1" min={0} max={5} value={form.minRating} onChange={(e) => set("minRating", e.target.value)} placeholder="any" />
              </div>
              <div className="space-y-1.5">
                <Label>Min reviews</Label>
                <Input type="number" min={0} value={form.minReviews} onChange={(e) => set("minReviews", e.target.value)} placeholder="any" />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Extra rules (plain English)</Label>
              <Textarea
                rows={3}
                value={form.customRules}
                onChange={(e) => set("customRules", e.target.value)}
                placeholder="e.g. only firms that manage single-family rentals; skip HOA-only shops; prefer smaller independents"
              />
              <p className="text-xs text-muted-foreground">
                {llmOn
                  ? "Applied by Claude to the ambiguous results."
                  : "Will apply once AI pruning is enabled (ANTHROPIC_API_KEY + HARVEST_LLM_ENABLED)."}
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Max per run</Label>
                <Input type="number" min={1} max={120} value={form.maxPerRun} onChange={(e) => set("maxPerRun", e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Auto-refill below</Label>
                <Input type="number" min={0} value={form.minDialable} onChange={(e) => set("minDialable", e.target.value)} />
                <p className="text-xs text-muted-foreground">Cron tops up when the campaign drops under this many dialable leads.</p>
              </div>
            </div>

            <Check label="Active (eligible for scheduled auto-refill)" checked={form.active} onChange={(v) => set("active", v)} />
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button onClick={save} disabled={pending}>
              {pending ? "Saving…" : editingId ? "Save changes" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
