"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Sparkles } from "lucide-react";
import { generateCampaignBrief } from "../actions";

/** One click → AI writes/refreshes the caller study sheet for this campaign. */
export function GenerateBriefButton({ id, hasBrief }: { id: string; hasBrief: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();

  return (
    <Button
      variant={hasBrief ? "ghost" : "default"}
      size="sm"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const res = await generateCampaignBrief(id);
          if (res.ok) {
            toast.success("Caller brief generated");
            router.refresh();
          } else toast.error(res.error);
        })
      }
    >
      <Sparkles className="size-4" />
      {pending ? "Writing…" : hasBrief ? "Regenerate" : "Generate caller brief"}
    </Button>
  );
}
