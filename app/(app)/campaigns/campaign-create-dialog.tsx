"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import { LEAD_STATUSES } from "@/lib/db/schema";
import { leadStatusLabel } from "@/components/lead-status-badge";
import { createCampaign } from "./actions";
import { Plus } from "lucide-react";

const NONE = "__none__";

export function CampaignCreateDialog({
  scripts,
  leadCounts,
}: {
  scripts: { id: string; name: string }[];
  leadCounts: Record<string, number>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [scriptId, setScriptId] = useState(NONE);
  const [seed, setSeed] = useState("new");
  const [pending, startTransition] = useTransition();

  function submit() {
    startTransition(async () => {
      const res = await createCampaign({
        name,
        description,
        scriptId: scriptId === NONE ? null : scriptId,
        seed,
      });
      if (res.ok) {
        toast.success("Campaign created");
        setOpen(false);
        setName("");
        setDescription("");
        setScriptId(NONE);
        setSeed("new");
        router.push(`/campaigns/${res.id}`);
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  }

  const seedCount = leadCounts[seed] ?? 0;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="size-4" />
          New campaign
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New campaign</DialogTitle>
          <DialogDescription>Group leads to dial and attach a script.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="c-name">Name</Label>
            <Input id="c-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Q3 Roofing" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="c-desc">Description (optional)</Label>
            <Textarea
              id="c-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Script</Label>
              <Select value={scriptId} onValueChange={setScriptId}>
                <SelectTrigger>
                  <SelectValue placeholder="None" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>No script</SelectItem>
                  {scripts.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Add leads</Label>
              <Select value={seed} onValueChange={setSeed}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None (add later)</SelectItem>
                  <SelectItem value="all">All leads ({leadCounts.all ?? 0})</SelectItem>
                  {LEAD_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {leadStatusLabel(s)} ({leadCounts[s] ?? 0})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          {seed !== "none" && (
            <p className="text-xs text-muted-foreground">
              Will add {seedCount} lead{seedCount === 1 ? "" : "s"}.
            </p>
          )}
        </div>
        <DialogFooter>
          <Button onClick={submit} disabled={pending || !name.trim()}>
            {pending ? "Creating…" : "Create campaign"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
