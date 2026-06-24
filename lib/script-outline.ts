/**
 * Parses a markdown call script into a navigable outline — the headings, in
 * document order, each with a clean display label and a slug that MATCHES the
 * `id` rehype-slug stamps on the rendered heading (both use github-slugger over
 * the same heading text, in order, so dedup suffixes line up). That lets the
 * cockpit's section browser jump straight to "Gatekeeper", "Voicemail", etc.
 *
 * Dynamic by design: it reads whatever headings a script happens to have, so it
 * works for any rep's script, not just the property-management one.
 */
import GithubSlugger from "github-slugger";

export type OutlineItem = {
  level: number; // 1-6 (## = 2, ### = 3, …)
  label: string; // cleaned for display ("KEY", not "---KEY---")
  id: string; // anchor id, equals the rendered heading's id
};

/**
 * Turn raw heading text into a friendly label: drop the `---DECORATION---`
 * dashes some scripts wrap section titles in, and strip inline markdown so
 * "**Voicemail**" shows as "Voicemail".
 */
export function cleanHeadingLabel(raw: string): string {
  let s = raw.trim();
  // The user's scripts wrap top sections like `## ---GATEKEEPER SCRIPT---`.
  s = s.replace(/^[-–—\s]+/, "").replace(/[-–—\s]+$/, "");
  // Strip inline markdown emphasis / code / links, keeping the text.
  s = s
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1") // [text](url) / ![alt](url)
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    .replace(/`([^`]+)`/g, "$1");
  return s.trim();
}

/**
 * Extract the heading outline from markdown. Skips fenced code blocks so a `#`
 * inside ``` isn't mistaken for a heading.
 */
export function parseOutline(md: string): OutlineItem[] {
  if (!md) return [];
  const slugger = new GithubSlugger(); // fresh per parse — mirrors rehype-slug
  const items: OutlineItem[] = [];
  let inFence = false;

  for (const line of md.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    const m = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (!m) continue;

    const rawText = m[2].trim();
    const label = cleanHeadingLabel(rawText);
    if (!label) continue;

    // Slug from the RAW text (what rehype-slug sees in the rendered heading),
    // so the outline's id matches the anchor exactly, dedupe included.
    items.push({ level: m[1].length, label, id: slugger.slug(rawText) });
  }

  return items;
}
