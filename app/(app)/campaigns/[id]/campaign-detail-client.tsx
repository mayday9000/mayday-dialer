"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Upload, Trash2, CopyPlus } from "lucide-react";

export function CampaignActions({ campaignId }: { campaignId: string }) {
  return (
    <Button asChild variant="outline">
      <Link href={`/campaigns/${campaignId}/leads/import`}>
        <Upload className="size-4" />
        Import CSV
      </Link>
    </Button>
  );
}

// Share leads between offers: copy another campaign's qualifying leads into this
// one. Same niche, different pitch → reuse the pool without double-dialing
// (recency + DNC stay global). Re-runnable; already-shared leads are skipped.
export function AddFromCampaignButton({
  campaignId,
  sources,
}: {
  campaignId: string;
  sources: { id: string; name: string; qualifying: number }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [sourceId, setSourceId] = useState("");
  const [pending, startTransition] = useTransition();
  const selected = sources.find((s) => s.id === sourceId);

  if (!sources.length) return null;

  function add() {
    if (!sourceId) return;
    startTransition(async () => {
      const { addLeadsFromCampaign } = await import("../actions");
      const res = await addLeadsFromCampaign(campaignId, sourceId);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(
        res.added
          ? `Added ${res.added} lead${res.added === 1 ? "" : "s"}`
          : "Nothing new — those leads are already in this campaign",
      );
      setOpen(false);
      setSourceId("");
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <CopyPlus className="size-4" />
          Add from campaign
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add leads from another campaign</DialogTitle>
          <DialogDescription>
            Copies the qualifying leads (skips discarded leads and unreviewed candidates) into this
            campaign. Already-shared leads are skipped, so it’s safe to run more than once.
          </DialogDescription>
        </DialogHeader>
        <div className="py-1">
          <Select value={sourceId} onValueChange={setSourceId}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Choose a campaign to copy from…" />
            </SelectTrigger>
            <SelectContent>
              {sources.map((s) => (
                <SelectItem key={s.id} value={s.id} disabled={s.qualifying === 0}>
                  {s.name} ({s.qualifying} qualifying)
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={add} disabled={!sourceId || pending}>
            {pending
              ? "Adding…"
              : selected
                ? `Add ${selected.qualifying} lead${selected.qualifying === 1 ? "" : "s"}`
                : "Add leads"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function RemoveLeadButton({ campaignId, leadId }: { campaignId: string; leadId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function remove() {
    startTransition(async () => {
      const { removeLeadFromCampaign } = await import("../actions");
      const res = await removeLeadFromCampaign(campaignId, leadId);
      if (res.ok) router.refresh();
      else toast.error(res.error);
    });
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      className="size-7 text-muted-foreground hover:text-destructive"
      onClick={remove}
      disabled={pending}
      title="Remove from campaign"
    >
      <Trash2 className="size-3.5" />
    </Button>
  );
}

export function StartDialingButton({ campaignId, disabled }: { campaignId: string; disabled?: boolean }) {
  if (disabled) {
    return (
      <Button disabled title="Add leads first">
        Start dialing
      </Button>
    );
  }
  return (
    <Button asChild>
      <Link href={`/dial?campaign=${campaignId}`}>Start dialing</Link>
    </Button>
  );
}
