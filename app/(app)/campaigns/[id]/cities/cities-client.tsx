"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { formatPhone } from "@/lib/phone";
import { addCity, searchCityNumbers, setCityActive, type AvailableNumber } from "./actions";
import { MapPin, Plus, Phone, Users, Loader2, EyeOff, Eye } from "lucide-react";

export type CityVM = {
  id: string;
  name: string;
  location: string | null;
  state: string | null;
  active: boolean;
  isDefault: boolean;
  leadCount: number;
  number: string | null;
};

export function CitiesClient({
  campaignId,
  cities,
  suggestedAreaCodes,
  defaultKeywords,
}: {
  campaignId: string;
  cities: CityVM[];
  suggestedAreaCodes: string[];
  defaultKeywords: string;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function toggleActive(c: CityVM) {
    startTransition(async () => {
      const r = await setCityActive(campaignId, c.id, !c.active);
      if (!r.ok) toast.error(r.error);
      else toast.success(c.active ? `${c.name} hidden` : `${c.name} restored`);
    });
  }

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-prose text-sm text-muted-foreground">
          Run this campaign in multiple cities. Each city scrapes its own leads and dials from
          its own local number — the dialer, leads, and call log filter by city.
        </p>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="size-4" /> Add city
            </Button>
          </DialogTrigger>
          <AddCityDialog
            campaignId={campaignId}
            suggestedAreaCodes={suggestedAreaCodes}
            defaultKeywords={defaultKeywords}
            onDone={() => setOpen(false)}
          />
        </Dialog>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {cities.map((c) => (
          <Card key={c.id} className={cn(!c.active && "opacity-60")}>
            <CardContent className="space-y-2 pt-6">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 font-medium">
                    <MapPin className="size-4 text-muted-foreground" />
                    {c.name}
                  </div>
                  {c.location && (
                    <div className="truncate text-xs text-muted-foreground">{c.location}</div>
                  )}
                </div>
                <div className="flex shrink-0 gap-1">
                  {c.isDefault && <Badge variant="secondary">Default</Badge>}
                  {!c.active && <Badge variant="outline">Hidden</Badge>}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Users className="size-3" /> {c.leadCount} lead{c.leadCount === 1 ? "" : "s"}
                </span>
                <span className="flex items-center gap-1">
                  <Phone className="size-3" />
                  {c.number ? formatPhone(c.number) : "No local number"}
                </span>
              </div>

              {!c.isDefault && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground"
                  disabled={pending}
                  onClick={() => toggleActive(c)}
                >
                  {c.active ? (
                    <>
                      <EyeOff className="size-3.5" /> Hide
                    </>
                  ) : (
                    <>
                      <Eye className="size-3.5" /> Restore
                    </>
                  )}
                </Button>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function AddCityDialog({
  campaignId,
  suggestedAreaCodes,
  defaultKeywords,
  onDone,
}: {
  campaignId: string;
  suggestedAreaCodes: string[];
  defaultKeywords: string;
  onDone: () => void;
}) {
  const [name, setName] = useState("");
  const [location, setLocation] = useState("");
  const [stateCode, setStateCode] = useState("");
  const [keywords, setKeywords] = useState(defaultKeywords);
  const [areaCode, setAreaCode] = useState(suggestedAreaCodes[0] ?? "");
  const [numbers, setNumbers] = useState<AvailableNumber[] | null>(null);
  const [chosenNumber, setChosenNumber] = useState<string | null>(null);
  const [runNow, setRunNow] = useState(true);
  const [searching, startSearch] = useTransition();
  const [saving, startSave] = useTransition();

  const ac = areaCode.replace(/\D/g, "").slice(0, 3);

  function findNumbers() {
    startSearch(async () => {
      const r = await searchCityNumbers(areaCode);
      if (r.ok) {
        setNumbers(r.numbers);
        setChosenNumber(r.numbers[0]?.phoneNumber ?? null);
      } else {
        toast.error(r.error);
      }
    });
  }

  function submit() {
    startSave(async () => {
      const r = await addCity({
        campaignId,
        name,
        location,
        state: stateCode || null,
        keywords: keywords || null,
        areaCodes: ac.length === 3 ? [ac] : [],
        buyNumber: chosenNumber ? { phoneNumber: chosenNumber, areaCode: ac } : null,
        runNow,
      });
      if (r.ok) {
        toast.success("City added — finding leads…");
        onDone();
      } else {
        toast.error(r.error);
      }
    });
  }

  return (
    <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>Add a city</DialogTitle>
        <DialogDescription>
          Scrapes its own leads and (optionally) dials from its own local number.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label>City name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Austin" />
          </div>
          <div className="space-y-1">
            <Label>State (optional)</Label>
            <Input
              value={stateCode}
              onChange={(e) => setStateCode(e.target.value)}
              placeholder="TX"
              maxLength={2}
            />
          </div>
        </div>

        <div className="space-y-1">
          <Label>Search location</Label>
          <Input
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="Austin, TX"
          />
          <p className="text-[11px] text-muted-foreground">
            Where the scraper looks — a city + state works best.
          </p>
        </div>

        <div className="space-y-1">
          <Label>Search keywords</Label>
          <Input
            value={keywords}
            onChange={(e) => setKeywords(e.target.value)}
            placeholder="property management"
          />
        </div>

        <div className="space-y-1.5 rounded-md border p-3">
          <Label>Local number (optional)</Label>
          <div className="flex items-end gap-2">
            <Input
              value={areaCode}
              onChange={(e) => setAreaCode(e.target.value)}
              placeholder="512"
              maxLength={3}
              className="w-28"
            />
            <Button
              type="button"
              variant="outline"
              onClick={findNumbers}
              disabled={searching || ac.length !== 3}
            >
              {searching ? <Loader2 className="size-4 animate-spin" /> : <Phone className="size-4" />}
              Find numbers
            </Button>
          </div>
          {suggestedAreaCodes.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
              Suggested:
              {suggestedAreaCodes.map((a) => (
                <button
                  key={a}
                  type="button"
                  onClick={() => setAreaCode(a)}
                  className="rounded border px-2 py-0.5 hover:bg-accent"
                >
                  {a}
                </button>
              ))}
            </div>
          )}
          {numbers && numbers.length > 0 && (
            <div className="space-y-1.5">
              {numbers.map((n) => (
                <label
                  key={n.phoneNumber}
                  className="flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm"
                >
                  <input
                    type="radio"
                    name="citynum"
                    checked={chosenNumber === n.phoneNumber}
                    onChange={() => setChosenNumber(n.phoneNumber)}
                  />
                  {n.friendly}
                </label>
              ))}
            </div>
          )}
          {numbers && numbers.length === 0 && (
            <p className="text-xs text-muted-foreground">No numbers found for that area code.</p>
          )}
          {chosenNumber && (
            <p className="text-xs text-amber-600">
              {chosenNumber} will be purchased (~$1/mo + usage).
            </p>
          )}
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={runNow} onChange={(e) => setRunNow(e.target.checked)} />
          Start finding leads immediately
        </label>
      </div>

      <DialogFooter>
        <Button onClick={submit} disabled={saving || !name.trim() || !location.trim()}>
          {saving ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
          Add city
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
