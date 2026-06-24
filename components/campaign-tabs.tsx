"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { Info, Users, FileText, CalendarCheck, History, MapPin } from "lucide-react";

export function CampaignTabs({ id }: { id: string }) {
  const pathname = usePathname();
  const base = `/campaigns/${id}`;
  const tabs = [
    { href: base, label: "Overview", icon: Info, exact: true },
    { href: `${base}/leads`, label: "Leads", icon: Users },
    { href: `${base}/cities`, label: "Cities", icon: MapPin },
    { href: `${base}/scripts`, label: "Scripts", icon: FileText },
    { href: `${base}/bookings`, label: "Bookings", icon: CalendarCheck },
    { href: `${base}/calls`, label: "Call log", icon: History },
  ];

  return (
    <div className="-mb-px flex gap-1 overflow-x-auto border-b whitespace-nowrap [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {tabs.map((t) => {
        const active = t.exact ? pathname === t.href : pathname.startsWith(t.href);
        const Icon = t.icon;
        return (
          <Link
            key={t.href}
            href={t.href}
            className={cn(
              "flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors",
              active
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="size-4" />
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}
