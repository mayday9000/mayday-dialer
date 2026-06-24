import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { campaigns, voicemails } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth-server";
import { AppNav } from "@/components/app-nav";
import { DialerProvider } from "@/components/dialer-provider";
import type { DialerProviderName } from "@/lib/dialer/types";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const [campaignList, unheardRows] = await Promise.all([
    db
      .select({ id: campaigns.id, name: campaigns.name })
      .from(campaigns)
      .orderBy(desc(campaigns.createdAt)),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(voicemails)
      .where(eq(voicemails.handled, false)),
  ]);
  const unheardVoicemails = unheardRows[0]?.n ?? 0;
  const provider: DialerProviderName =
    process.env.DIALER_PROVIDER === "twilio" ? "twilio" : "stub";

  return (
    // DialerProvider lives at the layout level so an active call survives
    // navigation between pages (the layout doesn't unmount on route changes).
    <DialerProvider provider={provider} userId={user.id}>
      {/* Column on phones (top bar + content), row on desktop (sidebar + content).
          h-dvh tracks the mobile browser's dynamic viewport (URL bar show/hide). */}
      <div className="flex h-dvh flex-col overflow-hidden md:flex-row">
        <AppNav user={user} campaigns={campaignList} unheardVoicemails={unheardVoicemails} />
        <main className="min-h-0 flex-1 overflow-auto">{children}</main>
      </div>
    </DialerProvider>
  );
}
