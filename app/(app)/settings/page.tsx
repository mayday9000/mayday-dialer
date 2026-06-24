import { Suspense } from "react";
import { requireUser } from "@/lib/auth-server";
import { getGoogleStatus, isGoogleConfigured } from "@/lib/google";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { GoogleConnection } from "./google-connection";
import { formatPhone } from "@/lib/phone";
import { ShieldCheck, CircleCheck, CircleAlert, Phone } from "lucide-react";

export default async function SettingsPage() {
  const user = await requireUser();
  const googleStatus = await getGoogleStatus(user.id);

  const provider = process.env.DIALER_PROVIDER === "twilio" ? "Twilio" : "Simulated (stub)";
  const callerId = process.env.TWILIO_CALLER_ID || null;

  // What the app enforces vs what stays the operator's responsibility.
  const enforced = [
    "Blocks dialing any lead marked Do-Not-Call",
    "Warns + requires confirmation outside 8am–9pm in the lead's local time (TCPA)",
    'Logs opt-outs as "Do not call" so they\'re never dialed again',
  ];
  const responsibilities = [
    "Scrub your list against the National DNC Registry (requires registered telemarketer access) before importing",
    "Register your caller ID for STIR/SHAKEN attestation with your carrier so calls aren't spam-flagged",
    "Honor state-specific calling rules and your own internal DNC requests",
    "Get legal review of your scripts, disclosures, and recording practices",
  ];

  return (
    <div className="flex flex-col">
      <PageHeader title="Settings" description="Integrations and compliance." />

      <div className="max-w-3xl space-y-6 p-6">
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Google Calendar
          </h2>
          <Suspense>
            <GoogleConnection status={googleStatus} configured={isGoogleConfigured()} />
          </Suspense>
        </section>

        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Telephony
          </h2>
          <Card>
            <CardContent className="flex items-center justify-between gap-4 py-4">
              <div className="flex items-center gap-3">
                <Phone className="size-5 text-muted-foreground" />
                <div>
                  <div className="text-sm font-medium">Provider: {provider}</div>
                  <div className="text-xs text-muted-foreground">
                    {callerId ? `Caller ID: ${formatPhone(callerId)}` : "No caller ID configured"}
                  </div>
                </div>
              </div>
              <Badge variant={provider === "Twilio" ? "secondary" : "outline"}>
                {provider === "Twilio" ? "Live" : "Stub"}
              </Badge>
            </CardContent>
          </Card>
        </section>

        <section className="space-y-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            <ShieldCheck className="size-4" />
            Compliance
          </h2>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">What the app enforces</CardTitle>
              <CardDescription>Guardrails built into the dialer.</CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2 text-sm">
                {enforced.map((e) => (
                  <li key={e} className="flex items-start gap-2">
                    <CircleCheck className="mt-0.5 size-4 shrink-0 text-green-600" />
                    {e}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
          <Card className="border-amber-400/50">
            <CardHeader>
              <CardTitle className="text-base">Still your responsibility</CardTitle>
              <CardDescription>
                These are legal/operational steps the app can&apos;t do for you. Not legal advice —
                confirm with counsel.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2 text-sm">
                {responsibilities.map((r) => (
                  <li key={r} className="flex items-start gap-2">
                    <CircleAlert className="mt-0.5 size-4 shrink-0 text-amber-500" />
                    {r}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </section>
      </div>
    </div>
  );
}
