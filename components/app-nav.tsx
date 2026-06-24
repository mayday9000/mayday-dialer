"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { signOut } from "@/lib/auth-client";
import { cn } from "@/lib/utils";
import {
  Users,
  FileText,
  CalendarCheck,
  ShieldCheck,
  LogOut,
  ChevronRight,
  LayoutDashboard,
  Megaphone,
  Info,
  PhoneCall,
  Settings,
  Radar,
  History,
  Voicemail,
  Menu,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";
import { NewCampaignButton } from "@/components/new-campaign-button";
import { Wordmark } from "@/components/wordmark";

type Campaign = { id: string; name: string };

function campaignIdFromPath(pathname: string): string | null {
  const m = pathname.match(/^\/campaigns\/([0-9a-f-]{36})/i);
  return m ? m[1] : null;
}

export function AppNav({
  user,
  campaigns,
  unheardVoicemails = 0,
}: {
  user: { name: string; email: string; role: string | null };
  campaigns: Campaign[];
  unheardVoicemails?: number;
}) {
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Close the mobile drawer whenever the route changes (sync to the router).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDrawerOpen(false);
  }, [pathname]);

  return (
    <>
      {/* Mobile top bar */}
      <header className="flex h-14 shrink-0 items-center gap-2 border-b bg-sidebar px-3 text-sidebar-foreground md:hidden">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setDrawerOpen(true)}
          aria-label="Open menu"
        >
          <Menu className="size-5" />
        </Button>
        <Link href="/" className="flex min-w-0 flex-1 items-center">
          <Wordmark />
        </Link>
        <ThemeToggle />
      </header>

      {/* Mobile drawer */}
      <div
        className={cn(
          "fixed inset-0 z-50 md:hidden",
          drawerOpen ? "" : "pointer-events-none",
        )}
        aria-hidden={!drawerOpen}
      >
        <div
          className={cn(
            "absolute inset-0 bg-black/50 transition-opacity duration-200",
            drawerOpen ? "opacity-100" : "opacity-0",
          )}
          onClick={() => setDrawerOpen(false)}
        />
        <aside
          className={cn(
            "absolute left-0 top-0 flex h-full w-72 max-w-[82vw] flex-col bg-sidebar text-sidebar-foreground shadow-xl transition-transform duration-200",
            drawerOpen ? "translate-x-0" : "-translate-x-full",
          )}
        >
          <div className="flex items-center justify-between px-4 py-3.5">
            <Link href="/" onClick={() => setDrawerOpen(false)}>
              <Wordmark />
            </Link>
            <Button variant="ghost" size="icon" onClick={() => setDrawerOpen(false)} aria-label="Close menu">
              <X className="size-5" />
            </Button>
          </div>
          <NavBody
            user={user}
            campaigns={campaigns}
            pathname={pathname}
            unheardVoicemails={unheardVoicemails}
            onNavigate={() => setDrawerOpen(false)}
          />
        </aside>
      </div>

      {/* Desktop sidebar */}
      <aside className="hidden w-60 shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground md:flex">
        <div className="px-4 py-4">
          <Link href="/">
            <Wordmark />
          </Link>
        </div>
        <NavBody
          user={user}
          campaigns={campaigns}
          pathname={pathname}
          unheardVoicemails={unheardVoicemails}
        />
      </aside>
    </>
  );
}

function NavBody({
  user,
  campaigns,
  pathname,
  unheardVoicemails = 0,
  onNavigate,
}: {
  user: { name: string; email: string; role: string | null };
  campaigns: Campaign[];
  pathname: string;
  unheardVoicemails?: number;
  onNavigate?: () => void;
}) {
  const router = useRouter();
  const [openId, setOpenId] = useState<string | null>(() => campaignIdFromPath(pathname));

  async function handleSignOut() {
    await signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <>
      <nav className="flex flex-1 flex-col gap-1 overflow-y-auto px-2 pb-2">
        <TopLink href="/" label="Overview" icon={LayoutDashboard} active={pathname === "/"} onNavigate={onNavigate} />
        <TopLink
          href="/inbox"
          label="Inbox"
          icon={Voicemail}
          active={pathname.startsWith("/inbox")}
          badge={unheardVoicemails}
          onNavigate={onNavigate}
        />
        {user.role === "admin" && (
          <TopLink
            href="/admin/lead-sources"
            label="Lead sources"
            icon={Radar}
            active={pathname.startsWith("/admin/lead-sources")}
            onNavigate={onNavigate}
          />
        )}

        {/* Campaigns section label + add */}
        <div className="mt-3 flex items-center justify-between px-3 pb-1 pt-1">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Campaigns
          </span>
          <NewCampaignButton variant="icon" />
        </div>

        {campaigns.length === 0 ? (
          <p className="px-3 py-2 text-xs text-muted-foreground">
            No campaigns yet. Use + to add one.
          </p>
        ) : (
          campaigns.map((c) => {
            const open = openId === c.id;
            const isActive = campaignIdFromPath(pathname) === c.id;
            return (
              <div key={c.id}>
                <button
                  onClick={() => setOpenId(open ? null : c.id)}
                  className={cn(
                    "flex w-full items-center gap-1.5 rounded-md px-2 py-2 text-sm font-medium transition-colors",
                    isActive
                      ? "text-foreground"
                      : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground",
                  )}
                >
                  <ChevronRight
                    className={cn("size-3.5 shrink-0 transition-transform", open && "rotate-90")}
                  />
                  <Megaphone className="size-4 shrink-0" />
                  <span className="truncate text-left">{c.name}</span>
                </button>

                {open && (
                  <div className="ml-3 flex flex-col gap-0.5 border-l pl-3 pt-0.5">
                    <SubLink href={`/campaigns/${c.id}`} label="Overview" icon={Info} active={pathname === `/campaigns/${c.id}`} onNavigate={onNavigate} />
                    <SubLink href={`/campaigns/${c.id}/leads`} label="Leads" icon={Users} active={pathname.startsWith(`/campaigns/${c.id}/leads`)} onNavigate={onNavigate} />
                    <SubLink href={`/campaigns/${c.id}/scripts`} label="Scripts" icon={FileText} active={pathname.startsWith(`/campaigns/${c.id}/scripts`)} onNavigate={onNavigate} />
                    <SubLink href={`/campaigns/${c.id}/bookings`} label="Bookings" icon={CalendarCheck} active={pathname.startsWith(`/campaigns/${c.id}/bookings`)} onNavigate={onNavigate} />
                    <SubLink href={`/campaigns/${c.id}/calls`} label="Call log" icon={History} active={pathname.startsWith(`/campaigns/${c.id}/calls`)} onNavigate={onNavigate} />
                    <SubLink href={`/dial?campaign=${c.id}`} label="Start dialing" icon={PhoneCall} active={false} accent onNavigate={onNavigate} />
                  </div>
                )}
              </div>
            );
          })
        )}
      </nav>

      <div className="border-t p-3">
        <Link
          href="/settings"
          onClick={onNavigate}
          className={cn(
            "mb-1 flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
            pathname.startsWith("/settings")
              ? "bg-sidebar-accent text-sidebar-accent-foreground"
              : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground",
          )}
        >
          <Settings className="size-4" />
          Settings
        </Link>
        {user.role === "admin" && (
          <Link
            href="/admin"
            onClick={onNavigate}
            className={cn(
              "mb-1 flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
              pathname === "/admin"
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground",
            )}
          >
            <ShieldCheck className="size-4" />
            Admin
          </Link>
        )}
        <div className="px-1 pb-2">
          <div className="truncate text-sm font-medium">{user.name}</div>
          <div className="truncate text-xs text-muted-foreground">{user.email}</div>
        </div>
        <div className="flex items-center justify-between gap-1">
          <Button variant="ghost" size="sm" className="justify-start" onClick={handleSignOut}>
            <LogOut className="size-4" />
            Sign out
          </Button>
          <span className="hidden md:block">
            <ThemeToggle />
          </span>
        </div>
      </div>
    </>
  );
}

function TopLink({
  href,
  label,
  icon: Icon,
  active,
  badge,
  onNavigate,
}: {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  active: boolean;
  badge?: number;
  onNavigate?: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      className={cn(
        "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
        active
          ? "bg-sidebar-accent text-sidebar-accent-foreground"
          : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground",
      )}
    >
      <Icon className="size-4" />
      {label}
      {!!badge && badge > 0 && (
        <span className="ml-auto inline-flex min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-xs font-semibold text-primary-foreground">
          {badge > 99 ? "99+" : badge}
        </span>
      )}
    </Link>
  );
}

function SubLink({
  href,
  label,
  icon: Icon,
  active,
  accent,
  onNavigate,
}: {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  active: boolean;
  accent?: boolean;
  onNavigate?: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      className={cn(
        "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition-colors",
        active
          ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
          : accent
            ? "text-primary hover:bg-sidebar-accent/60"
            : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground",
      )}
    >
      <Icon className="size-3.5" />
      {label}
    </Link>
  );
}
