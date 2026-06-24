"use client";

/**
 * Minimal theme system — replaces next-themes, whose anti-flash <script> is
 * rendered inside a client component and trips React 19's "script inside a
 * React component won't execute on the client" warning. The pre-paint init now
 * lives as a server-rendered script in the root layout (THEME_INIT_SCRIPT), so
 * there's no client <script> and no warning.
 *
 * State is read via useSyncExternalStore from localStorage + the OS preference
 * (the correct React 19 pattern for external stores — no effects, no
 * setState-in-effect), so theme is consistent across tabs and OS changes.
 */
import { useSyncExternalStore } from "react";

export type Theme = "light" | "dark" | "system";
type Resolved = "light" | "dark";

const STORAGE_KEY = "theme";

/** Pre-paint script (server-rendered in the layout): applies the stored/system
 *  theme before React mounts so there's no flash. */
export const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem('${STORAGE_KEY}')||'system';var d=t==='dark'||(t==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);var e=document.documentElement;e.classList.toggle('dark',d);e.style.colorScheme=d?'dark':'light';}catch(e){}})();`;

/**
 * Renders an inline `<script>` that runs synchronously during HTML parsing (no
 * flash) WITHOUT tripping React 19's "Encountered a script tag while rendering
 * React component" warning.
 *
 * The warning fires in react-dom's client (hydration) reconciler whenever it
 * reconciles a host `<script>` whose props are NOT a "script data block" — i.e.
 * an executable script that, by spec, can never run when inserted via the DOM
 * during hydration. The reconciler's `isScriptDataBlock(props)` check returns
 * `true` (and the warning is skipped) for non-executable `type` values like
 * `text/plain`. See node_modules/next/dist/compiled/react-dom (the App
 * Router's vendored react-dom), function `isScriptDataBlock` and the `case
 * "script"` branch of completeWork.
 *
 * So: emit `type="text/javascript"` on the server (the browser executes it as
 * it parses `<head>`, before paint) and `type="text/plain"` on the client (React
 * treats it as an inert data block during hydration, no warning, and the browser
 * never re-runs it). `suppressHydrationWarning` accepts the server/client `type`
 * mismatch. This is the pattern documented in Next.js'
 * "Preventing flash before hydration" guide.
 */
export function InlineScript({ html }: { html: string }) {
  return (
    <script
      type={typeof window === "undefined" ? "text/javascript" : "text/plain"}
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

function getSystem(): Resolved {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function readStored(): Theme {
  try {
    return (localStorage.getItem(STORAGE_KEY) as Theme | null) ?? "system";
  } catch {
    return "system";
  }
}

/** Apply a theme to <html>. `disableTransition` briefly kills CSS transitions so
 *  toggling doesn't animate every color. */
function apply(theme: Theme, disableTransition = false): Resolved {
  const resolved: Resolved = theme === "system" ? getSystem() : theme;
  const el = document.documentElement;
  let cleanup: (() => void) | undefined;
  if (disableTransition) {
    const style = document.createElement("style");
    style.appendChild(document.createTextNode("*,*::before,*::after{transition:none!important}"));
    document.head.appendChild(style);
    cleanup = () => {
      window.getComputedStyle(document.body);
      setTimeout(() => document.head.removeChild(style), 1);
    };
  }
  el.classList.toggle("dark", resolved === "dark");
  el.style.colorScheme = resolved;
  cleanup?.();
  return resolved;
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  const onMedia = () => {
    if (readStored() === "system") {
      apply("system");
      notify();
    }
  };
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) {
      apply(readStored());
      notify();
    }
  };
  mq.addEventListener("change", onMedia);
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(cb);
    mq.removeEventListener("change", onMedia);
    window.removeEventListener("storage", onStorage);
  };
}

// Snapshot encodes "theme|resolved" — a primitive, so Object.is dedupes cleanly.
function getSnapshot(): string {
  const t = readStored();
  return `${t}|${t === "system" ? getSystem() : t}`;
}
function getServerSnapshot(): string {
  return "system|light";
}

/** Set + persist the theme and apply it immediately (with transition guard). */
export function setTheme(t: Theme) {
  try {
    localStorage.setItem(STORAGE_KEY, t);
  } catch {
    /* private mode / disabled storage */
  }
  apply(t, true);
  notify();
}

export function useTheme(): { theme: Theme; resolvedTheme: Resolved; setTheme: (t: Theme) => void } {
  const snap = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const [theme, resolvedTheme] = snap.split("|") as [Theme, Resolved];
  return { theme, resolvedTheme, setTheme };
}

/** Passthrough — kept so the root layout's tree/API is unchanged. State lives in
 *  the module store above; no provider context needed. */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
