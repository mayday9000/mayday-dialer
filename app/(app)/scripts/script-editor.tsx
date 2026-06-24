"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { MarkdownView } from "@/components/markdown-view";
import { createScript, updateScript, deleteScript } from "./actions";
import { Upload, Save, Trash2 } from "lucide-react";

const SAMPLE = `# Opening
Hi, is this **{contact}**? This is _your name_ with _your company_.

## Reason for the call
- One sentence on why you're calling
- A question that earns 20 more seconds

## Handling "send me an email"
> "Happy to — what's the best address? While I have you, ..."

## Booking the meeting
Would **Tuesday at 10** or **Wednesday at 2** work better for a quick 15-minute call?
`;

export function ScriptEditor({
  initial,
  campaignId,
  returnHref = "/scripts",
}: {
  initial?: { id: string; name: string; contentMarkdown: string };
  campaignId?: string;
  returnHref?: string;
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(initial?.name ?? "");
  const [content, setContent] = useState(initial?.contentMarkdown ?? SAMPLE);
  const [pending, startTransition] = useTransition();

  function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setContent(String(reader.result ?? ""));
      if (!name) setName(file.name.replace(/\.(md|markdown|txt)$/i, ""));
      toast.success(`Loaded ${file.name}`);
    };
    reader.readAsText(file);
  }

  function save() {
    startTransition(async () => {
      const res = initial
        ? await updateScript(initial.id, name, content)
        : await createScript(name, content, campaignId);
      if (res.ok) {
        toast.success(initial ? "Script saved" : "Script created");
        router.push(returnHref);
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  }

  function remove() {
    if (!initial) return;
    if (!confirm("Delete this script?")) return;
    startTransition(async () => {
      const res = await deleteScript(initial.id);
      if (res.ok) {
        toast.success("Script deleted");
        router.push(returnHref);
        router.refresh();
      } else toast.error(res.error);
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-64 flex-1 space-y-1.5">
          <Label htmlFor="name">Script name</Label>
          <Input
            id="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Q3 Roofing Outreach"
          />
        </div>
        <input
          ref={fileRef}
          type="file"
          accept=".md,.markdown,.txt,text/markdown,text/plain"
          className="hidden"
          onChange={onUpload}
        />
        <Button variant="outline" onClick={() => fileRef.current?.click()}>
          <Upload className="size-4" />
          Upload .md
        </Button>
      </div>

      <Tabs defaultValue="edit">
        <TabsList>
          <TabsTrigger value="edit">Markdown</TabsTrigger>
          <TabsTrigger value="preview">Preview</TabsTrigger>
        </TabsList>
        <TabsContent value="edit">
          <Textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={22}
            className="font-mono text-sm"
            placeholder="Write your call script in markdown…"
          />
        </TabsContent>
        <TabsContent value="preview">
          <Card>
            <CardContent className="py-6">
              {content.trim() ? (
                <MarkdownView>{content}</MarkdownView>
              ) : (
                <p className="text-sm text-muted-foreground">Nothing to preview yet.</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <div className="flex items-center justify-between">
        <Button onClick={save} disabled={pending || !name.trim()}>
          <Save className="size-4" />
          {pending ? "Saving…" : initial ? "Save changes" : "Create script"}
        </Button>
        {initial && (
          <Button
            variant="ghost"
            className="text-muted-foreground hover:text-destructive"
            onClick={remove}
            disabled={pending}
          >
            <Trash2 className="size-4" />
            Delete
          </Button>
        )}
      </div>
    </div>
  );
}
