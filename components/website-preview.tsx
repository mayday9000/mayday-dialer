"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { ExternalLink, Globe, RefreshCw, TriangleAlert } from "lucide-react";

function normalize(url: string): string | null {
  if (!url?.trim()) return null;
  const u = url.trim();
  return /^https?:\/\//i.test(u) ? u : `https://${u}`;
}

function hostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/**
 * In-app website preview with a guaranteed fallback. Many sites block framing
 * via X-Frame-Options / CSP, and that can't be detected reliably cross-origin,
 * so we always show a header with favicon + domain + "Open in new tab", and a
 * persistent "blank? open in a new tab" hint under the frame.
 */
export function WebsitePreview({ website }: { website: string | null | undefined }) {
  const url = website ? normalize(website) : null;
  const [attempt, setAttempt] = useState(0);

  if (!url) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center text-sm text-muted-foreground">
        <Globe className="size-6" />
        No website on this lead.
      </div>
    );
  }

  const host = hostname(url);
  const favicon = `https://www.google.com/s2/favicons?domain=${host}&sz=32`;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-2 border-b bg-muted/40 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={favicon} alt="" className="size-4 rounded-sm" />
          <span className="truncate text-sm font-medium">{host}</span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            title="Reload preview"
            onClick={() => setAttempt((a) => a + 1)}
          >
            <RefreshCw className="size-3.5" />
          </Button>
          <Button variant="outline" size="sm" asChild>
            <a href={url} target="_blank" rel="noreferrer">
              Open <ExternalLink className="size-3.5" />
            </a>
          </Button>
        </div>
      </div>

      {/* Keyed remount resets the frame's loading state on reload / url change. */}
      <PreviewFrame key={`${url}::${attempt}`} url={url} host={host} favicon={favicon} />
    </div>
  );
}

function PreviewFrame({ url, host, favicon }: { url: string; host: string; favicon: string }) {
  const [state, setState] = useState<"loading" | "loaded" | "blocked">("loading");

  useEffect(() => {
    // If the frame never reports loaded, assume it's blocked.
    const t = setTimeout(() => setState((s) => (s === "loading" ? "blocked" : s)), 4500);
    return () => clearTimeout(t);
  }, []);

  if (state === "blocked") {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 bg-background p-8 text-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={favicon} alt="" className="size-8 rounded" />
        <div className="flex items-center gap-2 text-sm font-medium">
          <TriangleAlert className="size-4 text-amber-500" />
          This site blocks in-app preview
        </div>
        <p className="max-w-xs text-xs text-muted-foreground">
          {host} can&apos;t be embedded. Open it in a new tab to research the lead.
        </p>
        <Button asChild>
          <a href={url} target="_blank" rel="noreferrer">
            Open {host} <ExternalLink className="size-4" />
          </a>
        </Button>
      </div>
    );
  }

  return (
    <div className="relative flex-1 bg-background">
      {state === "loading" && (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
          Loading preview…
        </div>
      )}
      <iframe
        src={url}
        title={`Preview of ${host}`}
        className="h-full w-full"
        sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
        referrerPolicy="no-referrer"
        onLoad={() => setState((s) => (s === "loading" ? "loaded" : s))}
      />
      {/* Blocked frames still fire onLoad but render blank — always offer an out. */}
      <div className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-1.5 border-t bg-background/90 px-3 py-1.5 text-xs text-muted-foreground backdrop-blur">
        <TriangleAlert className="size-3 text-amber-500" />
        Blank? {host} may block embedding —
        <a href={url} target="_blank" rel="noreferrer" className="font-medium text-primary hover:underline">
          open in a new tab
        </a>
      </div>
    </div>
  );
}
