/**
 * Best-effort website discovery via DuckDuckGo's keyless HTML endpoint. Yelp
 * Fusion doesn't return a business's own site, so we search by name + city and
 * take the top NON-directory result that also shares a distinctive token with
 * the company name. If nothing passes the name guard we return null — better no
 * website than the wrong one (we never assert data we can't stand behind).
 *
 * This scrapes a search results page; kept low-volume + best-effort, and every
 * failure degrades to null.
 */
import * as cheerio from "cheerio";
import { normalizeName } from "../match";

const DDG_HTML = "https://html.duckduckgo.com/html/";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

// Directories / aggregators that are never the business's own site.
const DIRECTORY_DOMAINS = [
  "yelp.com", "facebook.com", "instagram.com", "linkedin.com", "yellowpages.com",
  "mapquest.com", "bbb.org", "indeed.com", "glassdoor.com", "zillow.com",
  "realtor.com", "apartments.com", "thumbtack.com", "angi.com", "manta.com",
  "chamberofcommerce.com", "x.com", "twitter.com", "youtube.com", "tiktok.com",
  "nextdoor.com", "trustpilot.com", "expertise.com", "birdeye.com", "houzz.com",
  "yellowbook.com", "superpages.com", "loopnet.com", "crexi.com", "wikipedia.org",
];

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

function isDirectory(host: string): boolean {
  return DIRECTORY_DOMAINS.some((d) => host === d || host.endsWith("." + d));
}

/** DDG result hrefs are redirects like //duckduckgo.com/l/?uddg=<encoded>. */
function decodeHref(href: string): string | null {
  try {
    const u = new URL(href, "https://duckduckgo.com");
    const uddg = u.searchParams.get("uddg");
    if (uddg) return decodeURIComponent(uddg);
    return /^https?:/i.test(href) ? href : null;
  } catch {
    return null;
  }
}

export async function findWebsite(name: string, city: string | null): Promise<string | null> {
  const nameTokens = new Set(normalizeName(name).split(" ").filter((t) => t.length >= 4));
  const q = `${name} ${city ?? ""} property management`.trim();

  let html: string;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(`${DDG_HTML}?q=${encodeURIComponent(q)}`, {
      signal: ctrl.signal,
      headers: { "User-Agent": UA, Accept: "text/html" },
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    html = await res.text();
  } catch {
    return null;
  }

  const $ = cheerio.load(html);
  for (const el of $("a.result__a").toArray()) {
    const href = $(el).attr("href");
    if (!href) continue;
    const url = decodeHref(href);
    if (!url) continue;
    const host = hostOf(url);
    if (!host || isDirectory(host)) continue;

    // Name guard: the domain or result title must share a distinctive token.
    const hostStem = host.split(".")[0];
    const title = normalizeName($(el).text());
    const titleTokens = new Set(title.split(" "));
    const shares =
      nameTokens.size === 0 ||
      [...nameTokens].some((t) => hostStem.includes(t) || titleTokens.has(t));
    if (shares) return url;
  }
  return null;
}
