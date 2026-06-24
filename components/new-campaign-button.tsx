"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";

/** Entry point to the campaign builder wizard (/campaigns/new). */
export function NewCampaignButton({
  variant = "icon",
}: {
  variant?: "icon" | "full";
}) {
  if (variant === "icon") {
    return (
      <Button asChild variant="ghost" size="icon" className="size-6" title="New campaign">
        <Link href="/campaigns/new">
          <Plus className="size-4" />
        </Link>
      </Button>
    );
  }
  return (
    <Button asChild size="sm" variant="outline" className="w-full justify-start">
      <Link href="/campaigns/new">
        <Plus className="size-4" />
        New campaign
      </Link>
    </Button>
  );
}
