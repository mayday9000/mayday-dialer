"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Star } from "lucide-react";
import { setPrimaryScript } from "@/app/(app)/scripts/actions";

export function SetPrimaryButton({
  campaignId,
  scriptId,
  isPrimary,
}: {
  campaignId: string;
  scriptId: string;
  isPrimary: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  // The current default is marked by a badge on the row; the control only needs
  // to offer "make this the default" for the others.
  if (isPrimary) return null;

  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={pending}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        startTransition(async () => {
          const res = await setPrimaryScript(campaignId, scriptId);
          if (res.ok) {
            toast.success("Set as team default");
            router.refresh();
          } else toast.error(res.error);
        });
      }}
    >
      <Star className="size-3.5" />
      Set default
    </Button>
  );
}
