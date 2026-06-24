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
import { updateCampaignMeta, deleteCampaign } from "../actions";
import { Pencil, Trash2 } from "lucide-react";

export function CampaignMetaEditor({
  id,
  initial,
}: {
  id: string;
  initial: {
    name: string;
    description: string;
    brief: string;
    location: string;
    industry: string;
    meetingTitleTemplate: string;
    meetingDescriptionTemplate: string;
    meetingDurationMin: string;
    meetingLocation: string;
  };
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [v, setV] = useState(initial);
  const [pending, startTransition] = useTransition();

  function set<K extends keyof typeof v>(k: K, val: string) {
    setV((prev) => ({ ...prev, [k]: val }));
  }

  function save() {
    startTransition(async () => {
      const res = await updateCampaignMeta(id, {
        ...v,
        meetingDurationMin: Number(v.meetingDurationMin) || 30,
      });
      if (res.ok) {
        toast.success("Campaign updated");
        setOpen(false);
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Pencil className="size-4" />
          Edit
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit campaign</DialogTitle>
          <DialogDescription>Brief supports markdown.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="m-name">Name</Label>
            <Input id="m-name" value={v.name} onChange={(e) => set("name", e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="m-industry">Industry</Label>
              <Input id="m-industry" value={v.industry} onChange={(e) => set("industry", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="m-location">Location</Label>
              <Input id="m-location" value={v.location} onChange={(e) => set("location", e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="m-desc">One-line summary</Label>
            <Textarea id="m-desc" value={v.description} onChange={(e) => set("description", e.target.value)} rows={2} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="m-brief">Brief (markdown)</Label>
            <Textarea
              id="m-brief"
              value={v.brief}
              onChange={(e) => set("brief", e.target.value)}
              rows={10}
              className="font-mono text-xs"
            />
          </div>

          {/* Booking invite defaults */}
          <div className="space-y-3 rounded-md border p-3">
            <div>
              <div className="text-sm font-medium">Booking defaults</div>
              <p className="text-xs text-muted-foreground">
                Prefill the Book dialog. Tokens: {"{company} {contact} {first} {city}"}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="m-mtitle">Meeting title</Label>
                <Input
                  id="m-mtitle"
                  value={v.meetingTitleTemplate}
                  onChange={(e) => set("meetingTitleTemplate", e.target.value)}
                  placeholder="Intro call — {company}"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1.5">
                  <Label>Duration</Label>
                  <Select
                    value={v.meetingDurationMin}
                    onValueChange={(val) => set("meetingDurationMin", val)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="15">15 min</SelectItem>
                      <SelectItem value="30">30 min</SelectItem>
                      <SelectItem value="45">45 min</SelectItem>
                      <SelectItem value="60">60 min</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="m-mloc">Location</Label>
                  <Input
                    id="m-mloc"
                    value={v.meetingLocation}
                    onChange={(e) => set("meetingLocation", e.target.value)}
                    placeholder="Phone / Zoom link"
                  />
                </div>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="m-mdesc">Meeting description</Label>
              <Textarea
                id="m-mdesc"
                value={v.meetingDescriptionTemplate}
                onChange={(e) => set("meetingDescriptionTemplate", e.target.value)}
                rows={2}
                placeholder="Quick intro call with {contact} at {company}…"
              />
            </div>
          </div>
        </div>
        <DialogFooter className="sm:justify-between">
          <Button
            variant="ghost"
            className="text-muted-foreground hover:text-destructive"
            disabled={pending}
            onClick={() => {
              if (!confirm("Delete this campaign? Leads themselves are not deleted.")) return;
              startTransition(async () => {
                const res = await deleteCampaign(id);
                if (res.ok) {
                  toast.success("Campaign deleted");
                  router.push("/");
                  router.refresh();
                } else toast.error(res.error);
              });
            }}
          >
            <Trash2 className="size-4" />
            Delete campaign
          </Button>
          <Button onClick={save} disabled={pending || !v.name.trim()}>
            {pending ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
