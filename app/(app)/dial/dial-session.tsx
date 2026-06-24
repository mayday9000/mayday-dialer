"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { formatDistanceToNow, format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { MarkdownView } from "@/components/markdown-view";
import { WebsitePreview } from "@/components/website-preview";
import { LeadStatusBadge } from "@/components/lead-status-badge";
import { EnrichmentField } from "@/components/enrichment-field";
import { BookingDialog, type BookingDefaults } from "@/components/booking-dialog";
import { useDialerCtx } from "@/components/dialer-provider";
import type { DialerProviderName } from "@/lib/dialer/types";
import { OUTCOMES, outcomeLabel } from "@/lib/dial";
import { personalizeScript } from "@/lib/script-personalize";
import { parseOutline } from "@/lib/script-outline";
import { ScriptOutlineRail, ScriptJump } from "@/components/script-outline";
import { selectScript } from "@/app/(app)/scripts/actions";
import type { ScriptOption } from "@/lib/rep-script";
import { callTimeInfo, leadTimezone } from "@/lib/compliance";
import { openStateFromHours, parseHoursText, type OpenState } from "@/lib/hours";
import { formatPhone, toE164 } from "@/lib/phone";
import { logCallOutcome, claimLead } from "./actions";
import {
  updateLead,
  archiveLead,
  generateLeadKeyNotes,
  setOfficeHours,
  type LeadPatch,
} from "@/app/(app)/leads/[id]/actions";
import type { LeadStatus, CallOutcome, LeadEnrichment, DayPeriod } from "@/lib/db/schema";
import {
  Phone,
  PhoneOff,
  Mic,
  MicOff,
  SkipForward,
  SkipBack,
  CalendarPlus,
  Mail,
  User,
  Building2,
  Megaphone,
  Zap,
  CheckCircle2,
  Clock,
  Ban,
  History,
  Globe,
  ExternalLink,
  Trash2,
  Sparkles,
  Lightbulb,
  Grid3x3,
  Delete,
  Shuffle,
  ArrowUpDown,
  Check,
  MapPin,
  ChevronDown,
  Voicemail,
} from "lucide-react";

// AI notes generated from a prior call's transcript (trimmed for the cockpit).
export type CallAnalysis = {
  summary?: string;
  bullets?: string[];
  nextStep?: string | null;
  objections?: string[];
};

export type QueueLead = {
  id: string;
  companyName: string | null;
  contactName: string | null;
  title: string | null;
  phoneDisplay: string;
  phoneE164: string | null;
  email: string | null;
  website: string | null;
  status: LeadStatus;
  // The city (within the campaign) this lead belongs to — drives the local
  // caller ID and the city filter. Null = unscoped.
  marketId: string | null;
  customFields: Record<string, string> | null;
  enrichment: LeadEnrichment | null;
  keyNotes: string[] | null;
  lastCall: { outcome: string | null; note: string | null; at: string } | null;
  // ISO time you last left a voicemail on this lead (null = never). Surfaced so
  // you can space voicemails out instead of leaving one on every attempt.
  lastVoicemailAt: string | null;
  // Recent call history (newest first) — outcome, note, duration, rep. Powers
  // the cockpit History tab so a previously-contacted lead's past is one click away.
  history: {
    at: string;
    outcome: string | null;
    note: string | null;
    durationSec: number | null;
    by: string | null;
    analysis?: CallAnalysis | null;
  }[];
};

const STATUS_DOT: Record<string, string> = {
  uninitialized: "bg-zinc-400",
  initializing: "bg-amber-400 animate-pulse",
  ready: "bg-green-500",
  connecting: "bg-amber-400 animate-pulse",
  ringing: "bg-amber-400 animate-pulse",
  active: "bg-green-500 animate-pulse",
  ended: "bg-zinc-400",
  error: "bg-red-500",
};

function defaultCallback(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 16);
}

function withProtocol(url: string) {
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

// Queue ordering — so you don't start on the same companies every day.
type OrderMode = "oldest" | "shuffle" | "uncalled" | "contact" | "default";
const ORDER_LABELS: Record<OrderMode, string> = {
  oldest: "Longest since contact",
  shuffle: "Shuffle",
  uncalled: "Never called first",
  contact: "Has contact first",
  default: "As added",
};
// Sort key for "oldest contact first": never-called leads sort to the very top
// (0), then by how long ago they were last contacted (oldest = smallest time).
function contactMs(l: QueueLead): number {
  return l.lastCall ? new Date(l.lastCall.at).getTime() : 0;
}

// Target spacing between voicemails on the same lead (~twice a month). A VM left
// more recently than this is flagged amber in the cockpit as "maybe skip this one".
const VM_PACING_MS = 14 * 24 * 60 * 60 * 1000;
function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
/** Pure reorder of the working queue (no Date.now/Math.random in render — the
 *  shuffle is deterministic given the seed, which is set in event handlers). */
function orderQueue(list: QueueLead[], mode: OrderMode, seed: number): QueueLead[] {
  if (mode === "default" || list.length < 2) return list;
  const a = [...list];
  if (mode === "shuffle") return a.sort((x, y) => hashStr(`${seed}:${x.id}`) - hashStr(`${seed}:${y.id}`));
  if (mode === "oldest") return a.sort((x, y) => contactMs(x) - contactMs(y));
  if (mode === "uncalled") return a.sort((x, y) => (x.lastCall ? 1 : 0) - (y.lastCall ? 1 : 0));
  if (mode === "contact") return a.sort((x, y) => (x.contactName ? 0 : 1) - (y.contactName ? 0 : 1));
  return a;
}

// Tiny localStorage helpers (client-only; swallow private-mode errors). Used to
// persist cockpit toggles + in-progress call notes across sessions/reloads.
function lsGet(k: string): string | null {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}
function lsSet(k: string, v: string): void {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* ignore */
  }
}
function lsDel(k: string): void {
  try {
    localStorage.removeItem(k);
  } catch {
    /* ignore */
  }
}

// "930"→"9:30a" / "1700"→"5p" — compact 12h for the hours-today chip.
function hhmm12(s: string): string {
  const h = parseInt(s.slice(0, 2), 10);
  const m = s.slice(2);
  const ampm = h < 12 ? "a" : "p";
  const h12 = ((h + 11) % 12) + 1;
  return m === "00" ? `${h12}${ampm}` : `${h12}:${m}${ampm}`;
}
// Today's actual office hours from the structured periods, e.g. "9a–5p" (or
// "closed today"). null when we have no structured hours.
function formatTodayHours(periods: DayPeriod[] | undefined, tz: string | null, nowMs: number): string | null {
  if (!periods?.length) return null;
  const wd = new Date(nowMs).toLocaleDateString("en-US", { timeZone: tz ?? undefined, weekday: "short" });
  const idx: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const today = idx[wd] ?? new Date(nowMs).getDay();
  const todays = periods.filter((p) => p.day === today).sort((a, b) => a.open.localeCompare(b.open));
  if (!todays.length) return "closed today";
  return todays.map((p) => `${hhmm12(p.open)}–${hhmm12(p.close)}`).join(", ");
}

// Elapsed call time → m:ss (or h:mm:ss for long calls).
function fmtCallTime(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

// A campaign's city + its local number, for the city selector + "From" display.
export type DialMarket = { id: string; name: string; number: string | null };

export function DialSession({
  provider,
  queue,
  scriptMarkdown,
  scriptOptions = [],
  selectedScriptId = null,
  campaignName,
  campaignId,
  callerId,
  markets = [],
  googleEmail,
  bookingDefaults,
}: {
  provider: DialerProviderName;
  queue: QueueLead[];
  scriptMarkdown: string | null;
  scriptOptions?: ScriptOption[];
  selectedScriptId?: string | null;
  campaignName: string | null;
  campaignId?: string | null;
  callerId?: string | null;
  markets?: DialMarket[];
  googleEmail?: string | null;
  bookingDefaults?: BookingDefaults;
}) {
  const dialer = useDialerCtx();
  const campaignKey = campaignName ?? "all";
  // We track the current lead by ID against a FROZEN working order — so the lead
  // never shifts under you (the open-now filter recomputing on the per-minute
  // clock used to swap the lead mid-call). The order changes ONLY when you
  // change it (order / open-now / reshuffle); the clock never reorders.
  const [workingIds, setWorkingIds] = useState<string[]>(() =>
    orderQueue(queue, "oldest", 1).map((l) => l.id),
  );
  const [currentId, setCurrentId] = useState<string | null>(() => {
    const ids = orderQueue(queue, "oldest", 1).map((l) => l.id);
    // Anchor to a live / just-ended call so a refresh stays on the company on the
    // line — and the outcome logs against the right lead.
    if (dialer.activeLead && (dialer.inCall || dialer.lastCall) && ids.includes(dialer.activeLead.id)) {
      return dialer.activeLead.id;
    }
    return ids[0] ?? null;
  });
  const [done, setDone] = useState(false);

  // Per-lead working state
  const [note, setNote] = useState("");
  const [outcome, setOutcome] = useState<CallOutcome | null>(null);
  const [status, setStatus] = useState<LeadStatus | null>(null);
  const [callbackAt, setCallbackAt] = useState(defaultCallback());
  const [bookingOpen, setBookingOpen] = useState(false);
  const [keypadOpen, setKeypadOpen] = useState(false);
  const [dtmf, setDtmf] = useState("");
  const [tab, setTab] = useState("script"); // right-panel tab (Script/About/History/Website)
  const [callSeconds, setCallSeconds] = useState(0); // live timer while connected
  const [saving, startSave] = useTransition();

  // Open-now queue filter + a ticking clock (re-evaluates open/closed each min).
  const [openOnly, setOpenOnly] = useState(false);
  // City (market) filter — scope the queue to one city. null = all cities. The
  // caller ID always tracks the *current lead's* city, so "all cities" still
  // dials each lead from its own local number.
  const [marketFilter, setMarketFilter] = useState<string | null>(null);
  // Queue order — default to "longest since contact" so the coldest follow-ups
  // (and never-called leads) surface first each session.
  const [order, setOrder] = useState<OrderMode>("oldest");
  const [shuffleSeed, setShuffleSeed] = useState(1);
  const [now, setNow] = useState(() => Date.now());
  // Optimistic manual-hours overrides (undefined = none, null = cleared).
  const [hoursById, setHoursById] = useState<
    Record<string, NonNullable<LeadEnrichment["officeHours"]> | null>
  >({});

  // Auto-dialer
  const [autoDial, setAutoDial] = useState(false);
  const [interval, setIntervalSec] = useState(8);
  const [countdown, setCountdown] = useState<number | null>(null);
  const pendingAutoCall = useRef(false);

  const onCallEnded = useCallback((info: { suggestedOutcome?: string }) => {
    const meta = OUTCOMES.find((o) => o.value === info.suggestedOutcome);
    if (meta) {
      setOutcome(meta.value);
      setStatus(meta.status);
    }
  }, []);

  // Office hours (with optimistic manual override) + open/closed state per lead.
  const officeHoursFor = (l: QueueLead) => {
    const o = hoursById[l.id];
    return o !== undefined ? o : (l.enrichment?.officeHours ?? null);
  };
  const openStateOf = (l: QueueLead): OpenState =>
    openStateFromHours(
      officeHoursFor(l)?.periods,
      leadTimezone({ phone: l.phoneDisplay, customFields: l.customFields }),
      now,
    );

  // Build the frozen working order: filter to open-now leads AT BUILD TIME only
  // (never on the clock tick), then apply the chosen order. Used by the mount
  // effect + the order/open-now/reshuffle handlers — not during render.
  function buildWorkingIds(
    o: OrderMode,
    seed: number,
    onlyOpen: boolean,
    market: string | null,
  ): string[] {
    let base = market ? queue.filter((l) => l.marketId === market) : queue;
    if (onlyOpen) base = base.filter((l) => openStateOf(l) === "open");
    return orderQueue(base, o, seed).map((l) => l.id);
  }

  // The current lead resolves from its ID against the frozen working order, so
  // a reorder/clock-tick can never swap which company you're on.
  const leadsById = useMemo(() => new Map(queue.map((l) => [l.id, l])), [queue]);
  const pos = currentId ? workingIds.indexOf(currentId) : -1;
  const lead = currentId ? leadsById.get(currentId) : undefined;

  // Inline edits (fill info as you learn it) — optimistic local overrides
  // merged onto the lead for display, persisted via updateLead.
  const [edits, setEdits] = useState<Record<string, Record<string, string | null>>>({});
  const view = lead ? { ...lead, ...(edits[lead.id] ?? {}) } : undefined;
  const leadName = view ? view.contactName || view.companyName || view.phoneDisplay : "";
  // The current lead's city + the local number we call it from. Falls back to
  // the campaign-level / global number when the city has no number of its own.
  const currentMarket = view ? markets.find((m) => m.id === view.marketId) ?? null : null;
  const fromNumber = currentMarket?.number ?? callerId ?? null;

  function saveField(field: "companyName" | "contactName" | "title" | "email" | "website", value: string) {
    if (!lead) return;
    const v = value.trim();
    setEdits((prev) => ({ ...prev, [lead.id]: { ...(prev[lead.id] ?? {}), [field]: v || null } }));
    updateLead(lead.id, { [field]: v } as LeadPatch).then((r) => {
      if (!r.ok) toast.error(r.error);
    });
  }

  // Phone is special: it drives the dial target + display, so update both the
  // formatted display and the E.164 we dial, optimistically.
  function savePhone(value: string) {
    if (!lead) return;
    const raw = value.trim();
    setEdits((prev) => ({
      ...prev,
      [lead.id]: { ...(prev[lead.id] ?? {}), phoneDisplay: formatPhone(raw), phoneE164: toE164(raw) },
    }));
    updateLead(lead.id, { phone: raw }).then((r) => {
      if (r.ok) toast.success("Number updated");
      else toast.error(r.error);
    });
  }

  // Manually set office hours learned on the call. Parsed to periods so the
  // open-now badge/filter update immediately.
  function saveHours(value: string) {
    if (!lead) return;
    const raw = value.trim();
    const field = raw
      ? {
          value: raw,
          verified: true,
          confidence: 0.95,
          sources: [{ name: "manual", url: null, value: raw, at: new Date().toISOString() }],
          periods: parseHoursText(raw) ?? undefined,
        }
      : null;
    setHoursById((prev) => ({ ...prev, [lead.id]: field }));
    setOfficeHours(lead.id, raw).then((r) => {
      if (r.ok) toast.success(raw ? "Hours updated" : "Hours cleared");
      else toast.error(r.error);
    });
  }

  // AI "Key Notes" — local overrides so a (re)generate updates instantly.
  const [keyNotesById, setKeyNotesById] = useState<Record<string, string[]>>({});
  const [notesLeadId, setNotesLeadId] = useState<string | null>(null);
  const keyNotes = lead ? keyNotesById[lead.id] ?? lead.keyNotes ?? [] : [];

  function regenerateKeyNotes() {
    if (!lead) return;
    setNotesLeadId(lead.id);
    generateLeadKeyNotes(lead.id)
      .then((r) => {
        if (r.ok) {
          setKeyNotesById((prev) => ({ ...prev, [lead.id]: r.notes }));
          toast.success("Key notes updated");
        } else {
          toast.error(r.error);
        }
      })
      .finally(() => setNotesLeadId(null));
  }

  // Register the per-call-ended handler + warm up the device on the dial page.
  const { registerOnEnded, ensureReady } = dialer;
  useEffect(() => {
    ensureReady();
    registerOnEnded(onCallEnded);
    return () => registerOnEnded(null);
  }, [ensureReady, registerOnEnded, onCallEnded]);

  // Each rep dials their own chosen script from the campaign's shared library.
  // Switching is instant (we ship every script's markdown) and persists in the
  // background so it sticks next session — and never touches anyone else's pick.
  const [activeScriptId, setActiveScriptId] = useState<string | null>(selectedScriptId ?? null);
  const [, startScriptSelect] = useTransition();
  const activeMarkdown = useMemo(() => {
    if (scriptOptions.length === 0) return scriptMarkdown;
    const found = scriptOptions.find((s) => s.id === activeScriptId) ?? scriptOptions[0];
    return found?.contentMarkdown ?? null;
  }, [scriptOptions, activeScriptId, scriptMarkdown]);

  const onPickScript = useCallback(
    (id: string) => {
      setActiveScriptId(id);
      if (campaignId) {
        startScriptSelect(async () => {
          const res = await selectScript(campaignId, id);
          if (!res.ok) toast.error(res.error);
        });
      }
    },
    [campaignId],
  );

  const personalizedScript =
    activeMarkdown && view ? personalizeScript(activeMarkdown, view, fromNumber) : null;

  // Section browser: the script's headings, so the rep can skip to GK / DM /
  // Quick Prop / Voicemail / Objections instantly mid-call. (Left unmemoized so
  // the React Compiler can optimize it — a manual useMemo here conflicts with
  // its analysis of the derived `personalizedScript` dependency.)
  const scriptScrollRef = useRef<HTMLDivElement>(null);
  const outline = personalizedScript ? parseOutline(personalizedScript) : [];

  const isDNC = lead?.status === "do_not_call";
  const callTime = lead ? callTimeInfo(lead) : null;
  const blockedHours = !!callTime?.known && !callTime.withinHours;
  // Use the (possibly edited) view, so an on-the-fly number change is dialed.
  const callable = !!view?.phoneE164 && !isDNC;

  const resetPerLead = useCallback(() => {
    setNote("");
    setOutcome(null);
    setStatus(null);
    setCallbackAt(defaultCallback());
    setKeypadOpen(false);
    setDtmf("");
    dialer.clearLastCall();
  }, [dialer]);

  function goNext(autoCall: boolean) {
    setCountdown(null);
    resetPerLead();
    const p = currentId ? workingIds.indexOf(currentId) : -1;
    const next = workingIds[p + 1];
    if (next) {
      pendingAutoCall.current = autoCall && autoDial;
      setCurrentId(next);
    } else {
      setDone(true);
    }
  }

  // Step back to the lead we just left (e.g. an accidental skip).
  function goPrev() {
    const p = currentId ? workingIds.indexOf(currentId) : -1;
    if (p <= 0) return;
    setCountdown(null);
    resetPerLead();
    pendingAutoCall.current = false;
    setCurrentId(workingIds[p - 1]);
  }

  async function placeCall() {
    if (!view?.phoneE164 || isDNC || !lead) return;
    if (blockedHours) {
      const ok = window.confirm(
        `It's ${callTime?.localTime} ${callTime?.abbr ?? ""} where this lead is — outside the legal calling window (8am–9pm local, TCPA). Call anyway?`,
      );
      if (!ok) return;
    }
    // Lock the lead so no teammate dials it at the same time. If someone else
    // already grabbed it, skip on so two reps never share a call.
    const claim = await claimLead(lead.id);
    if (!claim.ok) {
      toast.error(claim.error);
      goNext(false);
      return;
    }
    dialer.call(view.phoneE164, {
      id: view.id,
      name: leadName,
      campaignId: campaignId ?? undefined,
      marketId: view.marketId ?? undefined,
    });
  }

  useEffect(() => {
    if (dialer.error) toast.error(dialer.error);
  }, [dialer.error]);

  // Re-evaluate open/closed every minute.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(t);
  }, []);

  // Live call timer — reset + tick each second once the call connects.
  useEffect(() => {
    if (dialer.status !== "active") return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCallSeconds(0);
    const t = setInterval(() => setCallSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [dialer.status]);

  // Fresh shuffle each visit + restore saved toggles, then build the FROZEN
  // working order and pick the starting lead: live call > persisted (refresh
  // stays put) > first.
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    const seed = Math.floor(Math.random() * 1e9);
    setShuffleSeed(seed);
    let o: OrderMode = "oldest";
    let oo = false;
    const savedOrder = lsGet("dialOrder2") as OrderMode | null;
    if (savedOrder && savedOrder in ORDER_LABELS) {
      o = savedOrder;
      setOrder(savedOrder);
    }
    if (lsGet("dialOpenOnly") === "1") {
      oo = true;
      setOpenOnly(true);
    }
    if (lsGet("dialAutoDial") === "1") setAutoDial(true);
    const iv = Number(lsGet("dialInterval"));
    if (iv >= 2 && iv <= 120) setIntervalSec(iv);
    let mkt: string | null = null;
    const savedCity = lsGet(`dialCity:${campaignKey}`);
    if (savedCity && markets.some((m) => m.id === savedCity)) {
      mkt = savedCity;
      setMarketFilter(savedCity);
    }

    const ids = buildWorkingIds(o, seed, oo, mkt);
    setWorkingIds(ids);
    const active = dialer.activeLead;
    const persisted = lsGet(`dialCurrent:${campaignKey}`);
    let start: string | null = ids[0] ?? null;
    if (active && (dialer.inCall || dialer.lastCall) && ids.includes(active.id)) start = active.id;
    else if (persisted && ids.includes(persisted)) start = persisted;
    setCurrentId(start);
    /* eslint-enable react-hooks/set-state-in-effect */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist the current lead so a refresh lands right back on it.
  useEffect(() => {
    if (currentId) lsSet(`dialCurrent:${campaignKey}`, currentId);
  }, [currentId, campaignKey]);

  // Restore the in-progress note for the current lead — so typed notes survive
  // re-renders, remounts, and navigating away/back (persisted on every keystroke).
  useEffect(() => {
    if (!lead) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNote(lsGet(`note:${lead.id}`) ?? "");
    // Restore only when the lead ID changes (lead object is a fresh ref each render).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lead?.id]);

  // Keep the phone screen awake while a call is live (so it doesn't lock and
  // drop the WebRTC session mid-conversation). No-op where unsupported.
  useEffect(() => {
    if (!dialer.inCall) return;
    type WakeLockSentinel = { release: () => Promise<void> };
    const wl = (navigator as Navigator & {
      wakeLock?: { request: (t: "screen") => Promise<WakeLockSentinel> };
    }).wakeLock;
    if (!wl) return;
    let sentinel: WakeLockSentinel | null = null;
    let released = false;
    wl.request("screen")
      .then((s) => {
        if (released) s.release().catch(() => {});
        else sentinel = s;
      })
      .catch(() => {});
    return () => {
      released = true;
      sentinel?.release().catch(() => {});
    };
  }, [dialer.inCall]);

  // Auto-call the freshly-loaded lead when advancing in auto-dial mode.
  useEffect(() => {
    if (pendingAutoCall.current) {
      pendingAutoCall.current = false;
      if (callable && !blockedHours && view) {
        const v = view;
        claimLead(v.id).then((c) => {
          if (c.ok)
            dialer.call(v.phoneE164!, {
              id: v.id,
              name: leadName,
              campaignId: campaignId ?? undefined,
              marketId: v.marketId ?? undefined,
            });
          else {
            toast.error(c.error);
            goNext(true);
          }
        });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentId]);

  // Auto-dial countdown.
  useEffect(() => {
    if (countdown === null || countdown <= 0) return;
    const t = setTimeout(() => {
      if (countdown <= 1) {
        setCountdown(null);
        goNext(true);
      } else {
        setCountdown(countdown - 1);
      }
    }, 1000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [countdown]);

  // Toggle the "open now" filter; jump to the first lead of the new view.
  function toggleOpenOnly() {
    setCountdown(null);
    resetPerLead();
    pendingAutoCall.current = false;
    const next = !openOnly;
    setOpenOnly(next);
    const ids = buildWorkingIds(order, shuffleSeed, next, marketFilter);
    setWorkingIds(ids);
    setCurrentId(ids[0] ?? null);
    lsSet("dialOpenOnly", next ? "1" : "0");
  }

  // Switch which city you're dialing (rebuild the frozen order, restart at top).
  function changeCity(id: string | null) {
    setCountdown(null);
    resetPerLead();
    pendingAutoCall.current = false;
    setMarketFilter(id);
    const ids = buildWorkingIds(order, shuffleSeed, openOnly, id);
    setWorkingIds(ids);
    setCurrentId(ids[0] ?? null);
    if (id) lsSet(`dialCity:${campaignKey}`, id);
    else lsDel(`dialCity:${campaignKey}`);
  }

  // Change queue order (rebuild the frozen order, restart at its first lead).
  function changeOrder(mode: OrderMode) {
    setCountdown(null);
    resetPerLead();
    pendingAutoCall.current = false;
    const seed = mode === "shuffle" ? shuffleSeed + 1 : shuffleSeed;
    if (mode === "shuffle") setShuffleSeed(seed);
    setOrder(mode);
    const ids = buildWorkingIds(mode, seed, openOnly, marketFilter);
    setWorkingIds(ids);
    setCurrentId(ids[0] ?? null);
    lsSet("dialOrder2", mode);
  }
  function reshuffle() {
    setCountdown(null);
    resetPerLead();
    pendingAutoCall.current = false;
    const seed = shuffleSeed + 1;
    setShuffleSeed(seed);
    const ids = buildWorkingIds(order, seed, openOnly, marketFilter);
    setWorkingIds(ids);
    setCurrentId(ids[0] ?? null);
  }

  function pickOutcome(value: CallOutcome) {
    const meta = OUTCOMES.find((o) => o.value === value)!;
    setOutcome(value);
    setStatus(meta.status);
    if (value === "booked") setBookingOpen(true);
  }

  function saveAndNext() {
    if (!lead) return;
    if (!outcome || !status) {
      toast.error("Pick an outcome first.");
      return;
    }
    const leadId = lead.id;
    startSave(async () => {
      const res = await logCallOutcome({
        leadId,
        outcome,
        status,
        note,
        callbackAt: outcome === "callback" ? new Date(callbackAt).toISOString() : undefined,
        durationSec: dialer.lastCall?.durationSec ?? 0,
        callSid: dialer.lastCall?.callSid,
        provider,
        campaignId: campaignId ?? null,
        marketId: lead.marketId ?? null,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      lsDel(`note:${leadId}`); // logged → drop the saved draft
      toast.success("Logged");
      if (autoDial) setCountdown(interval);
      else goNext(false);
    });
  }

  function discard(reason: string) {
    if (!lead) return;
    const leadId = lead.id;
    archiveLead(leadId, reason).then((r) => {
      if (r.ok) {
        lsDel(`note:${leadId}`);
        toast.success("Lead discarded");
        goNext(false);
      } else {
        toast.error(r.error);
      }
    });
  }

  // --- Keyboard shortcuts (latest-ref pattern so the listener binds once) ---
  const kb = useRef<{
    call: () => void;
    mute: () => void;
    book: () => void;
    skip: () => void;
    prev: () => void;
    save: () => void;
    pick: (v: CallOutcome) => void;
  }>({
    call: () => {},
    mute: () => {},
    book: () => {},
    skip: () => {},
    prev: () => {},
    save: () => {},
    pick: () => {},
  });
  useEffect(() => {
    kb.current = {
      call: () => (dialer.inCall ? dialer.hangup() : placeCall()),
      mute: () => dialer.inCall && dialer.toggleMute(),
      book: () => setBookingOpen(true),
      skip: () => goNext(false),
      prev: () => goPrev(),
      save: () => outcome && saveAndNext(),
      pick: (v: CallOutcome) => pickOutcome(v),
    };
  });
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        kb.current.save();
        return;
      }
      const el = document.activeElement as HTMLElement | null;
      const typing =
        !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === "c") {
        e.preventDefault();
        kb.current.call();
      } else if (k === "m") {
        kb.current.mute();
      } else if (k === "b") {
        e.preventDefault();
        kb.current.book();
      } else if (k === "s") {
        e.preventDefault();
        kb.current.skip();
      } else if (k === "p") {
        e.preventDefault();
        kb.current.prev();
      } else if (k === "n" || k === "enter") {
        e.preventDefault();
        kb.current.save();
      } else if (/^[0-9]$/.test(k)) {
        const idx = k === "0" ? 9 : parseInt(k, 10) - 1;
        const o = OUTCOMES[idx];
        if (o) {
          e.preventDefault();
          kb.current.pick(o.value);
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (done) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 p-16 text-center">
        <CheckCircle2 className="size-12 text-green-600" />
        <div>
          <h2 className="text-xl font-semibold">Session complete</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            You worked through {workingIds.length} lead{workingIds.length === 1 ? "" : "s"}.
          </p>
        </div>
        <div className="flex gap-2">
          <Button asChild>
            <Link href="/">Back to Today</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href="/campaigns">Campaigns</Link>
          </Button>
        </div>
      </div>
    );
  }

  if (!lead) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-16 text-center text-sm text-muted-foreground">
        {marketFilter && queue.length > 0 ? (
          <>
            <MapPin className="size-8" />
            <div>
              No leads to dial in {markets.find((m) => m.id === marketFilter)?.name ?? "this city"}{" "}
              right now.
            </div>
            <Button variant="outline" size="sm" onClick={() => changeCity(null)}>
              Show all cities
            </Button>
          </>
        ) : openOnly && queue.length > 0 ? (
          <>
            <Clock className="size-8" />
            <div>None of your {queue.length} leads are open right now.</div>
            <Button variant="outline" size="sm" onClick={toggleOpenOnly}>
              Show all leads
            </Button>
          </>
        ) : (
          <>This list is empty. Add leads to the campaign and try again.</>
        )}
      </div>
    );
  }

  const remaining = pos >= 0 ? workingIds.length - pos - 1 : 0;
  const v = view!; // lead is defined past the guards above
  const officeHours = officeHoursFor(v);
  const open = openStateOf(v);
  const todayHours = formatTodayHours(
    officeHours?.periods,
    leadTimezone({ phone: v.phoneDisplay, customFields: v.customFields }),
    now,
  );
  // Most recent prior call that has AI notes — the compact "last call recap".
  const lastAnalysis = lead.history.find((h) => h.analysis)?.analysis ?? null;

  return (
    <div className="flex min-h-full flex-col lg:h-full">
      {/* Top bar */}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b px-3 py-2.5 md:px-6">
        <div className="flex items-center gap-3">
          {campaignName && (
            <Badge variant="secondary" className="gap-1">
              <Megaphone className="size-3" />
              {campaignName}
            </Badge>
          )}
          <span className="text-sm font-medium">
            Lead {pos + 1} of {workingIds.length}
          </span>
          {remaining > 0 && <span className="text-xs text-muted-foreground">{remaining} left</span>}
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className={cn("size-2 rounded-full", STATUS_DOT[dialer.status])} />
            {dialer.isStub ? "Simulated" : "Twilio"}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="hidden text-[11px] text-muted-foreground xl:inline">
            <kbd className="rounded border px-1">C</kbd> call ·{" "}
            <kbd className="rounded border px-1">1–9</kbd> outcome ·{" "}
            <kbd className="rounded border px-1">N</kbd> next ·{" "}
            <kbd className="rounded border px-1">S</kbd> skip ·{" "}
            <kbd className="rounded border px-1">P</kbd> back
          </span>
          {markets.length > 1 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" title="City" disabled={dialer.inCall}>
                  <MapPin className="size-4" />
                  {markets.find((m) => m.id === marketFilter)?.name ?? "All cities"}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => changeCity(null)}>
                  All cities
                  {marketFilter === null && <Check className="ml-auto size-3.5" />}
                </DropdownMenuItem>
                {markets.map((m) => (
                  <DropdownMenuItem key={m.id} onClick={() => changeCity(m.id)}>
                    {m.name}
                    {marketFilter === m.id && <Check className="ml-auto size-3.5" />}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" title="Queue order" disabled={dialer.inCall}>
                {order === "shuffle" ? <Shuffle className="size-4" /> : <ArrowUpDown className="size-4" />}
                {ORDER_LABELS[order]}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {(Object.keys(ORDER_LABELS) as OrderMode[]).map((m) => (
                <DropdownMenuItem key={m} onClick={() => changeOrder(m)}>
                  {ORDER_LABELS[m]}
                  {order === m && <Check className="ml-auto size-3.5" />}
                </DropdownMenuItem>
              ))}
              {order === "shuffle" && (
                <DropdownMenuItem onClick={reshuffle}>
                  <Shuffle className="size-3.5" /> Reshuffle
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            variant={openOnly ? "default" : "outline"}
            size="sm"
            onClick={toggleOpenOnly}
            disabled={dialer.inCall}
            title="Only show leads whose office is open right now (needs known hours)"
          >
            <Clock className="size-4" />
            Open now {openOnly ? "on" : "off"}
          </Button>
          <Button
            variant={autoDial ? "default" : "outline"}
            size="sm"
            onClick={() => {
              const next = !autoDial;
              setAutoDial(next);
              lsSet("dialAutoDial", next ? "1" : "0");
            }}
          >
            <Zap className="size-4" />
            Auto-dial {autoDial ? "on" : "off"}
          </Button>
          {autoDial && (
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Input
                type="number"
                min={2}
                max={120}
                value={interval}
                onChange={(e) => {
                  const v = Math.max(2, Number(e.target.value) || 8);
                  setIntervalSec(v);
                  lsSet("dialInterval", String(v));
                }}
                className="h-8 w-16"
              />
              s
            </div>
          )}
        </div>
      </div>

      {/* Main: left = act, right = read */}
      <div className="flex flex-col gap-4 p-3 sm:p-4 lg:grid lg:flex-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:overflow-hidden">
        {/* Left: identity + call + log */}
        <div className="flex flex-col gap-4 lg:min-h-0 lg:overflow-auto">
          {/* shrink-0: this column scrolls (lg:overflow-auto); without it the
              Card's own overflow-hidden lets flexbox shrink the card below its
              content and clip it (e.g. the dialpad got cut off). */}
          <Card className="shrink-0">
            <CardContent className="space-y-3 pt-6">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <Link href={`/leads/${lead.id}`} className="hover:underline">
                    <h2 className="flex items-center gap-2 text-lg font-semibold">
                      <Building2 className="size-4 text-muted-foreground" />
                      {v.companyName || "—"}
                    </h2>
                  </Link>
                  <div className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
                    <User className="size-3.5" />
                    {v.contactName || "—"}
                    {v.title ? ` · ${v.title}` : ""}
                  </div>
                </div>
                <LeadStatusBadge status={lead.status} />
              </div>

              {dialer.inCall && dialer.activeLead && dialer.activeLead.id !== lead.id && (
                <div className="rounded-md bg-amber-50 px-3 py-1.5 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                  Heads up: the live call is with <strong>{dialer.activeLead.name}</strong>, not this
                  lead. Switch to them (or hang up) before logging so the outcome lands on the right
                  company.
                </div>
              )}

              <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
                <span className="text-lg font-semibold tabular-nums">
                  {v.phoneDisplay || "No phone"}
                </span>
                {officeHours?.value ? (
                  <span
                    title={officeHours.value}
                    className={cn(
                      "flex items-center gap-1 text-xs",
                      open === "open"
                        ? "font-medium text-green-600 dark:text-green-400"
                        : open === "closed"
                          ? "text-amber-600 dark:text-amber-400"
                          : "text-muted-foreground",
                    )}
                  >
                    <Clock className="size-3.5" />
                    {open === "open"
                      ? "Open now"
                      : open === "closed"
                        ? "Closed now"
                        : officeHours.verified
                          ? "Hours verified"
                          : "Hours on file"}
                    {todayHours && (
                      <span className="font-normal text-muted-foreground">· {todayHours}</span>
                    )}
                  </span>
                ) : (
                  <span
                    className="flex items-center gap-1 text-xs text-muted-foreground"
                    title="We don't have verified office hours for this lead"
                  >
                    <Clock className="size-3.5" />
                    Hours unknown
                  </span>
                )}
                {v.email && (
                  <a
                    href={`mailto:${v.email}`}
                    className="flex items-center gap-1 text-muted-foreground hover:text-foreground"
                  >
                    <Mail className="size-3.5" />
                    {v.email}
                  </a>
                )}
              </div>

              {lead.lastCall && (
                <div className="flex items-start gap-2 rounded-md border bg-muted/40 px-3 py-1.5 text-xs">
                  <History className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                  <div className="min-w-0">
                    <span className="font-medium">
                      Last: {outcomeLabel(lead.lastCall.outcome) || "called"}
                    </span>{" "}
                    <span className="text-muted-foreground">
                      · {formatDistanceToNow(new Date(lead.lastCall.at), { addSuffix: true })}
                    </span>
                    {lead.lastCall.note && (
                      <span className="block truncate text-muted-foreground">
                        “{lead.lastCall.note}”
                      </span>
                    )}
                    {lead.lastVoicemailAt &&
                      (() => {
                        const recent = now - new Date(lead.lastVoicemailAt).getTime() < VM_PACING_MS;
                        return (
                          <span
                            className={`block ${recent ? "font-medium text-amber-600 dark:text-amber-500" : "text-muted-foreground"}`}
                            title="You aim to leave a voicemail about once every couple weeks"
                          >
                            <Voicemail className="mr-1 inline size-3 align-[-1px]" />
                            Last VM {formatDistanceToNow(new Date(lead.lastVoicemailAt), { addSuffix: true })}
                            {recent && " — maybe skip this one"}
                          </span>
                        );
                      })()}
                    {lead.history.length > 1 && (
                      <button
                        type="button"
                        onClick={() => setTab("history")}
                        className="mt-0.5 text-primary hover:underline"
                      >
                        View all {lead.history.length} calls →
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* Last call recap — AI notes from the most recent call, compact +
                  collapsible. The full per-call notes live in the History tab. */}
              {lastAnalysis && (
                <details className="group rounded-md border border-l-4 border-l-primary/50 bg-primary/5 px-3 py-2">
                  <summary className="list-none [&::-webkit-details-marker]:hidden">
                    <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-primary">
                      <Sparkles className="size-3.5" />
                      Last call recap
                      <ChevronDown className="ml-auto size-3.5 transition-transform group-open:rotate-180" />
                    </span>
                    {lastAnalysis.summary && (
                      <p className="mt-1 line-clamp-2 text-sm leading-snug text-foreground group-open:line-clamp-none">
                        {lastAnalysis.summary}
                      </p>
                    )}
                  </summary>
                  <div className="mt-1.5 space-y-1.5">
                    {!!lastAnalysis.bullets?.length && (
                      <ul className="list-disc space-y-0.5 pl-4 text-[13px] leading-snug">
                        {lastAnalysis.bullets.slice(0, 4).map((b, i) => (
                          <li key={i}>{b}</li>
                        ))}
                      </ul>
                    )}
                    {lastAnalysis.nextStep && (
                      <p className="text-xs">
                        <span className="font-medium">Next:</span> {lastAnalysis.nextStep}
                      </p>
                    )}
                    {!!lastAnalysis.objections?.length && (
                      <p className="text-xs text-muted-foreground">
                        <span className="font-medium">Objections:</span>{" "}
                        {lastAnalysis.objections.join("; ")}
                      </p>
                    )}
                    <button
                      type="button"
                      onClick={() => setTab("history")}
                      className="text-[11px] text-primary hover:underline"
                    >
                      Full notes in History →
                    </button>
                  </div>
                </details>
              )}

              {/* Key Notes — the must-know briefing before you dial. */}
              {keyNotes.length > 0 ? (
                <div className="rounded-md border border-indigo-200 border-l-4 border-l-indigo-500 bg-indigo-50/60 px-3 py-2 dark:border-indigo-900 dark:bg-indigo-950/30">
                  <div className="mb-1 flex items-center justify-between">
                    <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-indigo-700 dark:text-indigo-300">
                      <Lightbulb className="size-3.5" />
                      Key Notes
                    </span>
                    <button
                      type="button"
                      onClick={regenerateKeyNotes}
                      disabled={notesLeadId === lead.id}
                      className="text-[11px] text-indigo-600 hover:underline disabled:opacity-50 dark:text-indigo-400"
                    >
                      {notesLeadId === lead.id ? "Regenerating…" : "Regenerate"}
                    </button>
                  </div>
                  <ul className="list-disc space-y-1 pl-4 text-sm leading-snug">
                    {keyNotes.slice(0, 4).map((n, i) => (
                      <li key={i}>{n}</li>
                    ))}
                  </ul>
                </div>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={regenerateKeyNotes}
                  disabled={notesLeadId === lead.id}
                  className="gap-1.5 border-dashed text-muted-foreground"
                >
                  <Sparkles className="size-3.5" />
                  {notesLeadId === lead.id ? "Generating key notes…" : "Generate key notes"}
                </Button>
              )}

              {isDNC && (
                <div className="flex items-center gap-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-950/40 dark:text-red-300">
                  <Ban className="size-4" />
                  On Do-Not-Call — calling is blocked.
                </div>
              )}

              {/* Call controls — 2-col grid on phones (big thumb targets), inline on desktop */}
              <div className="grid grid-cols-2 gap-2 pt-1 sm:flex sm:flex-wrap sm:items-center">
                {!dialer.inCall ? (
                  <Button
                    size="lg"
                    variant={blockedHours && !isDNC ? "outline" : "default"}
                    onClick={placeCall}
                    disabled={!callable || dialer.status === "initializing"}
                  >
                    <Phone className="size-4" />
                    {isDNC
                      ? "Do-Not-Call"
                      : !v.phoneE164
                        ? "No number"
                        : blockedHours
                          ? "Call (closed hours)"
                          : "Call"}
                  </Button>
                ) : (
                  <>
                    <Button size="lg" variant="destructive" onClick={dialer.hangup}>
                      <PhoneOff className="size-4" />
                      Hang up
                    </Button>
                    <Button size="lg" variant="outline" onClick={dialer.toggleMute}>
                      {dialer.muted ? <MicOff className="size-4" /> : <Mic className="size-4" />}
                      {dialer.muted ? "Unmute" : "Mute"}
                    </Button>
                    <Button
                      size="lg"
                      variant={keypadOpen ? "default" : "outline"}
                      onClick={() => setKeypadOpen((o) => !o)}
                      title="Dial pad — send tones for phone menus / extensions"
                    >
                      <Grid3x3 className="size-4" />
                      Keypad
                    </Button>
                  </>
                )}
                <Button size="lg" variant="outline" onClick={() => setBookingOpen(true)}>
                  <CalendarPlus className="size-4" />
                  Book
                </Button>
              </div>

              {/* Live call status: ticking timer (or ringing) + the number you're calling from */}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                {dialer.inCall && (
                  <span className="flex items-center gap-1.5 font-medium tabular-nums">
                    <span
                      className={cn(
                        "size-2 rounded-full",
                        dialer.status === "active" ? "animate-pulse bg-green-500" : "animate-pulse bg-amber-400",
                      )}
                    />
                    {dialer.status === "active" ? (
                      fmtCallTime(callSeconds)
                    ) : (
                      <span className="font-normal text-muted-foreground">
                        {dialer.status === "ringing" ? "Ringing…" : "Connecting…"}
                      </span>
                    )}
                  </span>
                )}
                {fromNumber && (
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Phone className="size-3" />
                    From {formatPhone(fromNumber)}
                    {currentMarket && markets.length > 1 && (
                      <span className="text-muted-foreground/80">· {currentMarket.name}</span>
                    )}
                  </span>
                )}
              </div>

              {dialer.inCall && keypadOpen && (
                <div className="space-y-2 rounded-md border p-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">
                      Send tones to the call — type or tap (extensions, menus, name directories)
                    </span>
                    {dtmf && (
                      <span className="flex items-center gap-2">
                        <span className="font-mono text-sm tabular-nums">{dtmf}</span>
                        <button
                          type="button"
                          onClick={() => setDtmf("")}
                          className="text-muted-foreground hover:text-foreground"
                          title="Clear"
                        >
                          <Delete className="size-3.5" />
                        </button>
                      </span>
                    )}
                  </div>
                  <TypeToDial
                    onDigit={(d) => {
                      dialer.sendDigits(d);
                      setDtmf((s) => s + d);
                    }}
                  />
                  <DtmfKeypad
                    onDigit={(d) => {
                      dialer.sendDigits(d);
                      setDtmf((s) => s + d);
                    }}
                  />
                </div>
              )}
              {dialer.detail && <p className="text-xs text-muted-foreground">{dialer.detail}</p>}
            </CardContent>
          </Card>

          {/* Outcome + note + advance */}
          <Card className="shrink-0">
            <CardContent className="space-y-3 pt-6">
              <Label className="text-xs text-muted-foreground">Outcome</Label>
              <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
                {OUTCOMES.map((o, i) => (
                  <Button
                    key={o.value}
                    size="sm"
                    variant={outcome === o.value ? "default" : "outline"}
                    className={cn(
                      "h-auto justify-start gap-1.5 py-2 sm:py-1",
                      outcome === o.value && o.tone === "good" && "bg-green-600 hover:bg-green-600/90",
                      outcome === o.value && o.tone === "bad" && "bg-red-600 hover:bg-red-600/90",
                    )}
                    onClick={() => pickOutcome(o.value)}
                  >
                    {/* Number-key hint only for the first 10 (keys 1–9, 0). */}
                    {i < 10 && <span className="text-[10px] opacity-50">{(i + 1) % 10}</span>}
                    {o.label}
                  </Button>
                ))}
              </div>

              {outcome === "callback" && (
                <div className="space-y-1.5">
                  <Label htmlFor="cb" className="text-xs text-muted-foreground">
                    Call back when
                  </Label>
                  <Input
                    id="cb"
                    type="datetime-local"
                    value={callbackAt}
                    onChange={(e) => setCallbackAt(e.target.value)}
                    className="w-60"
                  />
                </div>
              )}

              {provider === "twilio" && (
                <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <Sparkles className="size-3 text-primary" />
                  Recorded calls are auto-summarized — notes are optional. Add anything extra here.
                </p>
              )}
              <Textarea
                value={note}
                onChange={(e) => {
                  setNote(e.target.value);
                  if (lead) lsSet(`note:${lead.id}`, e.target.value); // persist every keystroke
                }}
                rows={3}
                placeholder="Notes (optional) — the call writes its own summary…"
              />

              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    onClick={goPrev}
                    disabled={saving || pos <= 0}
                    title="Back to the previous lead (P)"
                  >
                    <SkipBack className="size-4" />
                    Back
                  </Button>
                  <Button variant="ghost" onClick={() => goNext(false)} disabled={saving}>
                    <SkipForward className="size-4" />
                    Skip
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        className="text-muted-foreground hover:text-destructive"
                        disabled={saving}
                      >
                        <Trash2 className="size-4" />
                        Discard
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start">
                      {["Wrong number", "No longer operating", "Wrong niche", "Other"].map((r) => (
                        <DropdownMenuItem key={r} onClick={() => discard(r)}>
                          {r}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                {countdown !== null ? (
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">Next in {countdown}s</span>
                    <Button variant="outline" size="sm" onClick={() => setCountdown(null)}>
                      Cancel
                    </Button>
                    <Button size="sm" onClick={() => goNext(true)}>
                      Now
                    </Button>
                  </div>
                ) : (
                  <Button onClick={saveAndNext} disabled={saving || !outcome}>
                    {saving ? "Saving…" : "Save & next"}
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right: read — script first, then about + website */}
        <div className="lg:min-h-0">
          <Tabs value={tab} onValueChange={setTab} className="flex flex-col lg:h-full">
            <TabsList className="shrink-0">
              <TabsTrigger value="script">Script</TabsTrigger>
              <TabsTrigger value="about">About</TabsTrigger>
              <TabsTrigger value="history">
                History{lead.history.length > 0 ? ` · ${lead.history.length}` : ""}
              </TabsTrigger>
              <TabsTrigger value="website">Website</TabsTrigger>
            </TabsList>

            <TabsContent
              value="script"
              className="mt-2 flex min-h-[50vh] flex-col overflow-hidden rounded-md border bg-card lg:min-h-0 lg:flex-1"
            >
              {scriptOptions.length > 1 && (
                <div className="flex items-center gap-2 border-b bg-muted/30 px-3 py-2">
                  <span className="shrink-0 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    Script
                  </span>
                  <select
                    value={activeScriptId ?? ""}
                    onChange={(e) => onPickScript(e.target.value)}
                    aria-label="Choose your script"
                    className="min-w-0 flex-1 rounded-md border bg-background px-2 py-1 text-sm"
                  >
                    {scriptOptions.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                  {campaignId && (
                    <Link
                      href={`/campaigns/${campaignId}/scripts`}
                      className="shrink-0 text-xs text-muted-foreground hover:text-foreground hover:underline"
                    >
                      Manage
                    </Link>
                  )}
                </div>
              )}
              {personalizedScript ? (
                <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
                  {outline.length > 0 && (
                    <ScriptOutlineRail
                      items={outline}
                      containerRef={scriptScrollRef}
                      className="hidden shrink-0 overflow-y-auto border-r p-2 lg:block lg:w-48 xl:w-56"
                    />
                  )}
                  <div ref={scriptScrollRef} className="min-h-0 min-w-0 flex-1 overflow-y-auto">
                    {outline.length > 1 && (
                      <div className="sticky top-0 z-10 border-b bg-card/95 p-2 backdrop-blur supports-[backdrop-filter]:bg-card/80 lg:hidden">
                        <ScriptJump items={outline} containerRef={scriptScrollRef} />
                      </div>
                    )}
                    <MarkdownView className="p-5">{personalizedScript}</MarkdownView>
                  </div>
                </div>
              ) : (
                <p className="p-5 text-sm text-muted-foreground">
                  No script attached.{" "}
                  <Link href="/campaigns" className="text-primary hover:underline">
                    Attach one
                  </Link>
                  .
                </p>
              )}
            </TabsContent>

            <TabsContent
              value="about"
              className="mt-2 min-h-[50vh] overflow-y-auto rounded-md border bg-card lg:min-h-0 lg:flex-1"
            >
              <AboutPanel
                key={v.id}
                lead={v}
                onSave={saveField}
                onSavePhone={savePhone}
                onSaveHours={saveHours}
              />
            </TabsContent>

            <TabsContent
              value="history"
              className="mt-2 min-h-[50vh] overflow-y-auto rounded-md border bg-card lg:min-h-0 lg:flex-1"
            >
              <HistoryPanel history={lead.history} />
            </TabsContent>

            <TabsContent value="website" className="mt-2 h-[60vh] lg:h-auto lg:min-h-0 lg:flex-1">
              <div className="h-full overflow-hidden rounded-md border">
                <WebsitePreview website={v.website} />
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </div>

      <BookingDialog
        key={lead.id}
        open={bookingOpen}
        onOpenChange={setBookingOpen}
        leadId={lead.id}
        leadName={leadName}
        lead={{
          companyName: v.companyName,
          contactName: v.contactName,
          email: v.email,
          phone: v.phoneDisplay,
          city: v.customFields?.City ?? null,
        }}
        defaults={bookingDefaults}
        googleEmail={googleEmail}
        onBooked={() => {
          setOutcome("booked");
          setStatus("booked");
        }}
      />
    </div>
  );
}

// Lead "summary" assembled from the data we have. (AI narrative is a future add.)
const FACT_ORDER = [
  "Focus",
  "Units / Size",
  "ICP Priority",
  "Category",
  "PM Software",
  "Office Address",
  "City",
];

function AboutPanel({
  lead,
  onSave,
  onSavePhone,
  onSaveHours,
}: {
  lead: QueueLead;
  onSave: (field: "companyName" | "contactName" | "title" | "email" | "website", value: string) => void;
  onSavePhone: (value: string) => void;
  onSaveHours: (value: string) => void;
}) {
  const cf = lead.customFields ?? {};
  const notes = cf["Prospect Notes"];
  const facts = FACT_ORDER.filter((k) => cf[k]).map((k) => [k, cf[k]] as const);
  const extras = Object.entries(cf).filter(
    ([k]) => !FACT_ORDER.includes(k) && k !== "Prospect Notes",
  );
  const enr = lead.enrichment ?? {};
  const hasEnrichment = Object.keys(enr).length > 0;

  return (
    <div className="space-y-4 p-5">
      <div>
        <h3 className="text-base font-semibold">{lead.companyName || "Lead"}</h3>
        <p className="text-xs text-muted-foreground">
          Fill in anything you learn — saves to the lead instantly.
        </p>
      </div>

      {/* Quick-edit fields (learn from the website or a gatekeeper) */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <QuickEdit label="Company" value={lead.companyName} onSave={(val) => onSave("companyName", val)} />
        </div>
        <QuickEdit label="Phone" value={lead.phoneDisplay} onSave={onSavePhone} />
        <QuickEdit label="Contact" value={lead.contactName} onSave={(val) => onSave("contactName", val)} />
        <QuickEdit label="Title" value={lead.title} onSave={(val) => onSave("title", val)} />
        <QuickEdit label="Email" value={lead.email} type="email" onSave={(val) => onSave("email", val)} />
        <div className="sm:col-span-2">
          <QuickEdit label="Website" value={lead.website} onSave={(val) => onSave("website", val)} />
        </div>
        <div className="sm:col-span-2">
          <QuickEdit
            label="Office hours"
            value={lead.enrichment?.officeHours?.value ?? null}
            onSave={onSaveHours}
          />
          <p className="mt-1 text-[11px] text-muted-foreground">
            e.g. “Mon-Fri 9-5”, “M-F 8:30-6, Sat 10-2” — used for the Open-now filter.
          </p>
        </div>
      </div>

      {lead.website && (
        <a
          href={withProtocol(lead.website)}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
        >
          <Globe className="size-3.5" />
          {lead.website}
          <ExternalLink className="size-3" />
        </a>
      )}

      {notes && (
        <div>
          <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Summary
          </div>
          <p className="text-sm leading-relaxed">{notes}</p>
        </div>
      )}

      {(facts.length > 0 || extras.length > 0) && (
        <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
          {[...facts, ...extras].map(([k, val]) => (
            <div key={k} className="border-b pb-1.5">
              <dt className="text-xs text-muted-foreground">{k}</dt>
              <dd className="text-sm">{val}</dd>
            </div>
          ))}
        </dl>
      )}

      {hasEnrichment && (
        <div>
          <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Enrichment
          </div>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
            <EnrichmentField label="Office hours" field={enr.officeHours} />
            <EnrichmentField label="Decision-maker" field={enr.dmName} />
            <EnrichmentField label="Email" field={enr.email} />
            <EnrichmentField label="Website" field={enr.website} />
            <EnrichmentField label="Social" field={enr.social} />
            <EnrichmentField label="Rating" field={enr.rating} />
          </dl>
        </div>
      )}
    </div>
  );
}

// Prior calls for the lead in the cockpit — outcome, when, how long, who, and
// the note left. Makes a previously-contacted lead's history one click away.
function HistoryPanel({ history }: { history: QueueLead["history"] }) {
  if (!history.length) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 p-10 text-center text-sm text-muted-foreground">
        <History className="size-7 opacity-60" />
        No previous calls to this lead yet.
      </div>
    );
  }
  return (
    <ol className="divide-y">
      {history.map((h, i) => {
        const meta = OUTCOMES.find((o) => o.value === h.outcome);
        const when = new Date(h.at);
        return (
          <li key={i} className="space-y-1.5 px-4 py-3">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <Badge
                variant="outline"
                className={cn(
                  meta?.tone === "good" && "border-green-300 text-green-700 dark:border-green-900 dark:text-green-400",
                  meta?.tone === "bad" && "border-red-300 text-red-700 dark:border-red-900 dark:text-red-400",
                )}
              >
                {outcomeLabel(h.outcome) || "Called"}
              </Badge>
              <span className="text-sm font-medium tabular-nums">{format(when, "MMM d, yyyy · h:mm a")}</span>
              <span className="text-xs text-muted-foreground">
                {formatDistanceToNow(when, { addSuffix: true })}
              </span>
            </div>
            {(h.durationSec || h.by) && (
              <div className="flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
                {h.durationSec ? (
                  <span className="flex items-center gap-1">
                    <Clock className="size-3" />
                    {fmtCallTime(h.durationSec)} on call
                  </span>
                ) : null}
                {h.by && (
                  <span className="flex items-center gap-1">
                    <User className="size-3" />
                    {h.by}
                  </span>
                )}
              </div>
            )}
            {h.note && <p className="whitespace-pre-wrap text-sm leading-snug">{h.note}</p>}
            {h.analysis && (
              <details className="rounded-md border-l-2 border-l-primary/40 bg-muted/40 px-3 py-1.5">
                <summary className="flex cursor-pointer items-center gap-1.5 text-xs font-semibold text-primary">
                  <Sparkles className="size-3.5" />
                  AI call notes
                </summary>
                <div className="mt-1.5 space-y-1.5 text-sm leading-snug">
                  {h.analysis.summary && <p>{h.analysis.summary}</p>}
                  {!!h.analysis.bullets?.length && (
                    <ul className="list-disc space-y-0.5 pl-4 text-[13px]">
                      {h.analysis.bullets.map((b, j) => (
                        <li key={j}>{b}</li>
                      ))}
                    </ul>
                  )}
                  {h.analysis.nextStep && (
                    <p className="text-xs">
                      <span className="font-medium">Next:</span> {h.analysis.nextStep}
                    </p>
                  )}
                  {!!h.analysis.objections?.length && (
                    <p className="text-xs text-muted-foreground">
                      <span className="font-medium">Objections:</span>{" "}
                      {h.analysis.objections.join("; ")}
                    </p>
                  )}
                </div>
              </details>
            )}
          </li>
        );
      })}
    </ol>
  );
}

// Standard phone keypad (ITU E.161) — digit plus the letters printed on it.
const DTMF_KEYS: { key: string; letters?: string }[] = [
  { key: "1" },
  { key: "2", letters: "ABC" },
  { key: "3", letters: "DEF" },
  { key: "4", letters: "GHI" },
  { key: "5", letters: "JKL" },
  { key: "6", letters: "MNO" },
  { key: "7", letters: "PQRS" },
  { key: "8", letters: "TUV" },
  { key: "9", letters: "WXYZ" },
  { key: "*" },
  { key: "0", letters: "+" },
  { key: "#" },
];

// Letter → keypad digit, derived from DTMF_KEYS so the two never drift.
const LETTER_TO_DIGIT: Record<string, string> = Object.fromEntries(
  DTMF_KEYS.flatMap(({ key, letters }) =>
    (letters ?? "")
      .split("")
      .filter((c) => /[A-Z]/.test(c))
      .map((c) => [c.toLowerCase(), key]),
  ),
);

// Translate one typed character to the DTMF tone it should send: letters map to
// their keypad digit (so a name can be entered into a phone directory), while
// digits, * and # pass through untouched. Returns null for anything else.
function charToTone(ch: string): string | null {
  if (/[0-9*#]/.test(ch)) return ch;
  return LETTER_TO_DIGIT[ch.toLowerCase()] ?? null;
}

// DTMF dial pad — sends tones during a live call (phone trees, extensions).
function DtmfKeypad({ onDigit }: { onDigit: (d: string) => void }) {
  return (
    <div className="grid grid-cols-3 gap-1.5">
      {DTMF_KEYS.map(({ key, letters }) => (
        <button
          key={key}
          type="button"
          onClick={() => onDigit(key)}
          className="flex flex-col items-center justify-center rounded-md border py-1.5 leading-none transition-colors hover:bg-accent active:bg-accent/70"
        >
          <span className="text-lg font-medium tabular-nums">{key}</span>
          <span className="mt-0.5 h-2.5 text-[0.6rem] font-semibold uppercase tracking-[0.15em] text-muted-foreground">
            {letters ?? ""}
          </span>
        </button>
      ))}
    </div>
  );
}

// A text field that turns natural typing into DTMF tones — type "SMITH" and it
// sends 7-6-4-8-4, the way phone directory prompts ("enter the first few letters
// of the last name") expect. The visible field keeps the letters you typed; the
// panel's "Tones sent" line shows the digits actually transmitted.
function TypeToDial({ onDigit }: { onDigit: (d: string) => void }) {
  return (
    <input
      type="text"
      inputMode="text"
      autoComplete="off"
      autoCorrect="off"
      autoCapitalize="characters"
      spellCheck={false}
      autoFocus
      placeholder="Type to send — letters map to digits (SMITH → 76484)"
      className="w-full rounded-md border bg-background px-2.5 py-1.5 text-sm uppercase tracking-wide outline-none placeholder:normal-case placeholder:tracking-normal focus-visible:ring-1 focus-visible:ring-ring"
      onKeyDown={(e) => {
        // Leave keyboard shortcuts (⌘C, Ctrl-A, …) and editing/navigation keys alone.
        if (e.metaKey || e.ctrlKey || e.altKey || e.key.length !== 1) return;
        const tone = charToTone(e.key);
        if (tone) onDigit(tone);
        // Swallow characters with no keypad equivalent so the field only ever
        // shows what was actually dialed.
        else e.preventDefault();
      }}
      onPaste={(e) => {
        e.preventDefault();
        for (const ch of e.clipboardData.getData("text")) {
          const tone = charToTone(ch);
          if (tone) onDigit(tone);
        }
      }}
    />
  );
}

// Labeled input that persists on blur when changed. Remounted per lead (keyed),
// so it always starts from the current lead's value.
function QuickEdit({
  label,
  value,
  type = "text",
  onSave,
}: {
  label: string;
  value: string | null;
  type?: string;
  onSave: (v: string) => void;
}) {
  const original = value ?? "";
  const [val, setVal] = useState(original);
  return (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Input
        type={type}
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onBlur={() => {
          if (val !== original) onSave(val);
        }}
        className="h-8"
      />
    </div>
  );
}
