"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { MarkdownView } from "@/components/markdown-view";
import type { CampaignBrief, CampaignGoalType } from "@/lib/db/schema";
import type { OfferVariant } from "@/lib/ai/offer";
import {
  architectCampaign,
  strengthenOfferAction,
  generateScriptAction,
  previewLeads,
  searchNumbers,
  launchCampaign,
  type PreviewLead,
  type AvailableNumber,
} from "./actions";
import {
  Sparkles,
  Loader2,
  Phone,
  Globe,
  ArrowRight,
  ArrowLeft,
  Check,
  Rocket,
  Wand2,
} from "lucide-react";

const STEPS = ["Define", "Offer", "Leads", "Script", "Number", "Launch"] as const;
const GOALS: { v: CampaignGoalType; label: string }[] = [
  { v: "meeting", label: "Book a meeting" },
  { v: "sale", label: "Drive a sale" },
  { v: "qualify", label: "Qualify" },
  { v: "survey", label: "Survey" },
];

const lines = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);
const commas = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);

export function CampaignWizard() {
  const router = useRouter();
  const [pending, start] = useTransition();

  // Step 0 (spark)
  const [drafted, setDrafted] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [goalType, setGoalType] = useState<CampaignGoalType>("meeting");

  // Wizard step (after drafting)
  const [step, setStep] = useState(0);

  // Brief-backed editable state
  const [name, setName] = useState("");
  const [brief, setBrief] = useState<CampaignBrief | null>(null);
  const setB = (patch: Partial<CampaignBrief>) => setBrief((b) => (b ? { ...b, ...patch } : b));

  // Offer
  const [variants, setVariants] = useState<OfferVariant[]>([]);

  // Leads
  const [preview, setPreview] = useState<PreviewLead[] | null>(null);
  const [requireWebsite, setRequireWebsite] = useState(false);
  const [requirePhone, setRequirePhone] = useState(true);

  // Script
  const [script, setScript] = useState("");
  const [showScriptPreview, setShowScriptPreview] = useState(false);

  // Number
  const [areaCode, setAreaCode] = useState("");
  const [numbers, setNumbers] = useState<AvailableNumber[] | null>(null);
  const [chosenNumber, setChosenNumber] = useState<string | null>(null);

  // Launch
  const [runNow, setRunNow] = useState(true);

  function draft() {
    if (!prompt.trim()) return;
    start(async () => {
      const res = await architectCampaign(prompt, goalType);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setBrief(res.brief);
      setName(res.name);
      setAreaCode(res.brief.areaCodes?.[0] ?? "");
      setDrafted(true);
      setStep(0);
      toast.success("Campaign drafted — review each step");
    });
  }

  function strengthen() {
    if (!brief) return;
    start(async () => {
      const res = await strengthenOfferAction(brief, brief.offer);
      if (res.ok) setVariants(res.variants);
      else toast.error(res.error);
    });
  }

  function genScript() {
    if (!brief) return;
    start(async () => {
      const res = await generateScriptAction(brief, brief.offer);
      if (res.ok) {
        setScript(res.markdown);
        toast.success("Script generated");
      } else toast.error(res.error);
    });
  }

  function runPreview() {
    if (!brief) return;
    start(async () => {
      const res = await previewLeads(brief.keywords || brief.vertical, brief.geography);
      if (res.ok) {
        setPreview(res.leads);
        if (!res.leads.length) toast.message("No sample leads found — try different terms.");
      } else toast.error(res.error);
    });
  }

  function findNumbers() {
    start(async () => {
      const res = await searchNumbers(areaCode);
      if (res.ok) {
        setNumbers(res.numbers);
        if (!res.numbers.length) toast.message("No numbers free in that area code.");
      } else toast.error(res.error);
    });
  }

  function launch() {
    if (!brief) return;
    start(async () => {
      const res = await launchCampaign({
        name,
        brief,
        offer: brief.offer,
        description: brief.goal,
        scriptMarkdown: script || null,
        scraper: {
          keywords: brief.keywords || brief.vertical,
          location: brief.geography,
          extraAreas: brief.extraAreas ?? [],
          radiusMiles: brief.radiusMiles ?? null,
          requireWebsite,
          requirePhone,
        },
        buyNumber: chosenNumber ? { phoneNumber: chosenNumber, areaCode } : null,
        runNow,
      });
      if (res.ok) {
        toast.success("Campaign launched");
        router.push(`/campaigns/${res.id}`);
        router.refresh();
      } else toast.error(res.error);
    });
  }

  // ---- Step 0: the spark ----
  if (!drafted || !brief) {
    return (
      <div className="mx-auto max-w-2xl space-y-5 p-4 md:p-6">
        <div>
          <h1 className="font-heading text-2xl font-semibold">New campaign</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Describe it in a sentence. We&apos;ll draft the offer, the leads to call, a script, and a
            local number — you refine each step.
          </p>
        </div>
        <Textarea
          autoFocus
          rows={3}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="e.g. Restaurants in the Philly metro — sell them online ordering that cuts third-party delivery fees; book 15-minute demos."
          className="text-base"
        />
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">Goal:</span>
          {GOALS.map((g) => (
            <button
              key={g.v}
              type="button"
              onClick={() => setGoalType(g.v)}
              className={cn(
                "rounded-full border px-3 py-1 text-xs transition-colors",
                goalType === g.v ? "border-primary bg-primary/10 text-foreground" : "text-muted-foreground hover:bg-accent",
              )}
            >
              {g.label}
            </button>
          ))}
        </div>
        <Button size="lg" onClick={draft} disabled={pending || !prompt.trim()} className="gap-2">
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Wand2 className="size-4" />}
          {pending ? "Researching…" : "Draft my campaign"}
        </Button>
      </div>
    );
  }

  // ---- Stepper ----
  const goPrev = () => setStep((s) => Math.max(0, s - 1));
  const goNext = () => setStep((s) => Math.min(STEPS.length - 1, s + 1));

  return (
    <div className="mx-auto max-w-2xl space-y-5 p-4 md:p-6">
      {/* Stepper */}
      <div className="flex items-center gap-1 overflow-x-auto pb-1">
        {STEPS.map((label, i) => (
          <button
            key={label}
            type="button"
            onClick={() => setStep(i)}
            className={cn(
              "flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-colors",
              i === step ? "bg-primary text-primary-foreground" : i < step ? "text-foreground" : "text-muted-foreground",
            )}
          >
            <span
              className={cn(
                "flex size-4 items-center justify-center rounded-full text-[10px]",
                i < step ? "bg-primary/15 text-primary" : i === step ? "bg-primary-foreground/20" : "bg-muted",
              )}
            >
              {i < step ? <Check className="size-3" /> : i + 1}
            </span>
            {label}
          </button>
        ))}
      </div>

      <div className="min-h-75">
        {/* Step 1: Define */}
        {step === 0 && (
          <Section title="Define the campaign" hint="Drafted from your idea — edit anything.">
            <Field label="Campaign name">
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Vertical">
                <Input value={brief.vertical} onChange={(e) => setB({ vertical: e.target.value })} />
              </Field>
              <Field label="Geography">
                <Input value={brief.geography} onChange={(e) => setB({ geography: e.target.value })} />
              </Field>
            </div>
            <Field label="Who we're calling (ICP)">
              <Textarea rows={2} value={brief.icp} onChange={(e) => setB({ icp: e.target.value })} />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Goal">
                <Input value={brief.goal} onChange={(e) => setB({ goal: e.target.value })} />
              </Field>
              <Field label="Ask for (persona)">
                <Input value={brief.persona ?? ""} onChange={(e) => setB({ persona: e.target.value })} />
              </Field>
            </div>
            <Field label="Nearby areas to also search (comma-separated)">
              <Input
                value={(brief.extraAreas ?? []).join(", ")}
                onChange={(e) => setB({ extraAreas: commas(e.target.value) })}
              />
            </Field>
          </Section>
        )}

        {/* Step 2: Offer */}
        {step === 1 && (
          <Section title="Sharpen the offer" hint="Your draft may be weak — let AI strengthen it, then pick one.">
            <Field label="Offer (pitched on the call)">
              <Textarea rows={3} value={brief.offer} onChange={(e) => setB({ offer: e.target.value })} />
            </Field>
            <Button variant="outline" onClick={strengthen} disabled={pending} className="gap-2">
              {pending ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
              Strengthen with AI
            </Button>
            {variants.length > 0 && (
              <div className="space-y-2">
                {variants.map((v, i) => (
                  <div key={i} className="rounded-md border p-3">
                    <p className="text-sm">{v.offer}</p>
                    <p className="mt-1 text-xs text-muted-foreground">Why: {v.rationale}</p>
                    <Button
                      size="sm"
                      variant="secondary"
                      className="mt-2"
                      onClick={() => {
                        setB({ offer: v.offer });
                        toast.success("Offer updated");
                      }}
                    >
                      Use this
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </Section>
        )}

        {/* Step 3: Leads */}
        {step === 2 && (
          <Section title="Find the right leads" hint="The scraper uses these. Preview a sample before you commit.">
            <Field label="Search term">
              <Input value={brief.keywords ?? ""} onChange={(e) => setB({ keywords: e.target.value })} placeholder={brief.vertical} />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Good-fit signals (one per line)">
                <Textarea rows={3} value={(brief.qualifiers ?? []).join("\n")} onChange={(e) => setB({ qualifiers: lines(e.target.value) })} />
              </Field>
              <Field label="Skip if (one per line)">
                <Textarea rows={3} value={(brief.disqualifiers ?? []).join("\n")} onChange={(e) => setB({ disqualifiers: lines(e.target.value) })} />
              </Field>
            </div>
            <div className="flex flex-wrap gap-4 text-sm">
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={requirePhone} onChange={(e) => setRequirePhone(e.target.checked)} />
                Require a phone number
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={requireWebsite} onChange={(e) => setRequireWebsite(e.target.checked)} />
                Require a website
              </label>
            </div>
            <Button variant="outline" onClick={runPreview} disabled={pending} className="gap-2">
              {pending ? <Loader2 className="size-4 animate-spin" /> : <Globe className="size-4" />}
              Preview sample leads
            </Button>
            {preview && (
              <div className="space-y-1.5">
                {preview.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No sample leads — try a different search term.</p>
                ) : (
                  preview.map((l, i) => (
                    <div key={i} className="rounded-md border px-3 py-2 text-sm">
                      <div className="font-medium">{l.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {[l.address, l.phone, l.website].filter(Boolean).join(" · ") || "—"}
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </Section>
        )}

        {/* Step 4: Script */}
        {step === 3 && (
          <Section title="Generate the script" hint="In your house style, simplified, with voicemail + objections.">
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={genScript} disabled={pending} className="gap-2">
                {pending ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                {script ? "Regenerate" : "Generate script"}
              </Button>
              {script && (
                <Button variant="ghost" onClick={() => setShowScriptPreview((v) => !v)}>
                  {showScriptPreview ? "Edit" : "Preview"}
                </Button>
              )}
            </div>
            {script ? (
              showScriptPreview ? (
                <div className="rounded-md border bg-card p-4">
                  <MarkdownView>{script}</MarkdownView>
                </div>
              ) : (
                <Textarea rows={16} value={script} onChange={(e) => setScript(e.target.value)} className="font-mono text-xs" />
              )
            ) : (
              <p className="text-sm text-muted-foreground">No script yet — generate one (or skip and add later).</p>
            )}
          </Section>
        )}

        {/* Step 5: Number */}
        {step === 4 && (
          <Section title="Local number" hint="A local caller ID lifts answer rates. Optional — you can skip.">
            <div className="flex items-end gap-2">
              <Field label="Area code" className="w-32">
                <Input value={areaCode} onChange={(e) => setAreaCode(e.target.value)} placeholder="215" maxLength={3} />
              </Field>
              <Button variant="outline" onClick={findNumbers} disabled={pending || areaCode.replace(/\D/g, "").length !== 3} className="gap-2">
                {pending ? <Loader2 className="size-4 animate-spin" /> : <Phone className="size-4" />}
                Find numbers
              </Button>
            </div>
            {brief.areaCodes && brief.areaCodes.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                Suggested:
                {brief.areaCodes.map((a) => (
                  <button key={a} type="button" onClick={() => setAreaCode(a)} className="rounded border px-2 py-0.5 hover:bg-accent">
                    {a}
                  </button>
                ))}
              </div>
            )}
            {numbers && (
              <div className="space-y-1.5">
                {numbers.map((n) => (
                  <label key={n.phoneNumber} className="flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm">
                    <input type="radio" name="num" checked={chosenNumber === n.phoneNumber} onChange={() => setChosenNumber(n.phoneNumber)} />
                    {n.friendly}
                  </label>
                ))}
              </div>
            )}
            {chosenNumber && (
              <p className="text-xs text-amber-600">
                {chosenNumber} will be purchased on launch (~$1/mo + usage).
              </p>
            )}
          </Section>
        )}

        {/* Step 6: Review & Launch */}
        {step === 5 && (
          <Section title="Review & launch" hint="Creates the campaign, scraper, script, and number — then finds leads.">
            <dl className="space-y-2 rounded-md border p-4 text-sm">
              <Row k="Campaign" v={name} />
              <Row k="Targets" v={`${brief.vertical} · ${brief.geography}`} />
              <Row k="Goal" v={brief.goal} />
              <Row k="Offer" v={brief.offer} />
              <Row k="Script" v={script ? "Generated ✓" : "None (add later)"} />
              <Row k="Number" v={chosenNumber ? `${chosenNumber} (buy)` : "Skip"} />
            </dl>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={runNow} onChange={(e) => setRunNow(e.target.checked)} />
              Start finding leads immediately
            </label>
            <Button size="lg" onClick={launch} disabled={pending} className="w-full gap-2">
              {pending ? <Loader2 className="size-4 animate-spin" /> : <Rocket className="size-4" />}
              {pending ? "Launching…" : "Launch campaign"}
            </Button>
          </Section>
        )}
      </div>

      {/* Nav */}
      <div className="flex items-center justify-between border-t pt-4">
        <Button variant="ghost" onClick={goPrev} disabled={step === 0}>
          <ArrowLeft className="size-4" /> Back
        </Button>
        {step < STEPS.length - 1 && (
          <Button onClick={goNext}>
            Next <ArrowRight className="size-4" />
          </Button>
        )}
      </div>
    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">{title}</h2>
        {hint && <p className="text-sm text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </div>
  );
}

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex gap-3">
      <dt className="w-24 shrink-0 text-muted-foreground">{k}</dt>
      <dd className="min-w-0 flex-1">{v}</dd>
    </div>
  );
}
