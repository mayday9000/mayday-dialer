"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Check, Copy } from "lucide-react";
import { selectScript, duplicateScript } from "@/app/(app)/scripts/actions";

/** "Use this" — make this script the current rep's pick for the campaign. */
export function UseScriptButton({
  campaignId,
  scriptId,
  inUse,
}: {
  campaignId: string;
  scriptId: string;
  inUse: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  if (inUse) {
    return (
      <Badge className="gap-1">
        <Check className="size-3" /> You&apos;re using
      </Badge>
    );
  }

  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const res = await selectScript(campaignId, scriptId);
          if (res.ok) {
            toast.success("This is now your script");
            router.refresh();
          } else toast.error(res.error);
        })
      }
    >
      Use this
    </Button>
  );
}

/** "Duplicate" — fork the script into a copy you own and open it to edit. */
export function DuplicateScriptButton({
  campaignId,
  scriptId,
}: {
  campaignId: string;
  scriptId: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  return (
    <Button
      variant="ghost"
      size="icon"
      className="size-8"
      disabled={pending}
      title="Duplicate into your own copy"
      onClick={() =>
        start(async () => {
          const res = await duplicateScript(scriptId);
          if (res.ok && res.id) {
            toast.success("Duplicated — edit your copy");
            router.push(`/campaigns/${campaignId}/scripts/${res.id}`);
          } else if (!res.ok) toast.error(res.error);
        })
      }
    >
      <Copy className="size-4" />
    </Button>
  );
}
