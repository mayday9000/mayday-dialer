/**
 * Enriches a kept candidate. Keeps source-provided fields (website, hours,
 * rating, address — tagged with the discovery source), scrapes the homepage
 * AND the About/Team/Contact pages, then uses Haiku to pull the decision-maker
 * (owner/principal) + email/social. Falls back to DuckDuckGo to find a website
 * when a source gave none. Each field records its source(s); verify.ts decides
 * the verified flag. The extracted contact also populates the lead's
 * contactName/title in ingest.
 */
import * as cheerio from "cheerio";
import type { Classified, Enriched } from "./types";
import type { DayPeriod, EnrichedField, FieldSource, LeadEnrichment } from "../db/schema";
import { findWebsite } from "./sources/website-find";
import { placesLookup } from "./sources/places";
import { verifyEnrichment } from "./verify";
import { extractDecisionMaker } from "../ai/contact";
import { harvestConfig, isPlacesConfigured } from "./config";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

// Pages most likely to name the owner/principal.
const PEOPLE_PAGE =
  /(about|team|our-team|our-people|staff|leadership|meet|who-we-are|company|contact|founder|principal)/i;

const nowIso = () => new Date().toISOString();
const withProtocol = (u: string) => (/^https?:\/\//i.test(u) ? u : `https://${u}`);
const field = (value: string, source: FieldSource): EnrichedField => ({
  value,
  verified: false,
  confidence: 0.45,
  sources: [source],
});

export type EnrichInput = {
  companyName: string;
  city: string | null;
  website: string | null;
  hoursText?: string | null;
  periods?: DayPeriod[] | null;
  address?: string | null;
  rating?: number | null;
  reviewCount?: number | null;
  source: { name: string; url: string | null };
};

export type EnrichOutput = {
  enrichment: LeadEnrichment;
  website: string | null;
  websiteText: string | null;
};

async function fetchHtml(url: string): Promise<string | null> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(withProtocol(url), {
      signal: ctrl.signal,
      headers: { "User-Agent": UA, Accept: "text/html" },
      redirect: "follow",
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") ?? "";
    if (!ct.includes("text/html")) return null;
    return await res.text();
  } catch {
    return null;
  }
}

type Scraped = { email: string | null; social: string[]; text: string };

function scrape(html: string): Scraped {
  const $ = cheerio.load(html);
  $("script, style, noscript, svg").remove();

  let email: string | null = null;
  const mailto = $('a[href^="mailto:"]').first().attr("href");
  if (mailto) email = mailto.replace(/^mailto:/i, "").split("?")[0].trim() || null;
  if (!email) {
    const m = $.root().text().match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
    if (m && !/\.(png|jpe?g|gif|webp|svg)$/i.test(m[0])) email = m[0];
  }

  const social = new Set<string>();
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href") || "";
    if (/(facebook|instagram|linkedin)\.com\//i.test(href)) social.add(href.split("?")[0]);
  });

  const text = $("body").text().replace(/\s+/g, " ").trim().slice(0, 5000);
  return { email, social: [...social].slice(0, 4), text };
}

/** Up to 2 internal About/Team/Contact page URLs from the homepage nav. */
function peoplePages(html: string, baseUrl: string): string[] {
  const $ = cheerio.load(html);
  let base: URL;
  try {
    base = new URL(withProtocol(baseUrl));
  } catch {
    return [];
  }
  const ranked = new Map<string, number>();
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href") || "";
    const label = $(el).text();
    const inHref = PEOPLE_PAGE.test(href);
    if (!inHref && !PEOPLE_PAGE.test(label)) return;
    try {
      const u = new URL(href, base);
      if (u.hostname.replace(/^www\./, "") !== base.hostname.replace(/^www\./, "")) return;
      u.hash = "";
      const key = u.toString();
      if (key === base.toString()) return;
      ranked.set(key, Math.max(ranked.get(key) ?? 0, inHref ? 2 : 1));
    } catch {
      /* skip */
    }
  });
  return [...ranked.entries()].sort((a, b) => b[1] - a[1]).map(([u]) => u).slice(0, 2);
}

/** Build (unverified) enrichment for a single candidate/lead. */
export async function enrichCandidate(c: EnrichInput): Promise<EnrichOutput> {
  const enrichment: LeadEnrichment = {};
  const mk = (value: string): FieldSource => ({
    name: c.source.name,
    url: c.source.url,
    value,
    at: nowIso(),
  });

  // 1) Source-provided fields.
  let website = c.website;
  if (c.website) enrichment.website = field(c.website, mk(c.website));
  if (c.hoursText) {
    enrichment.officeHours = { ...field(c.hoursText, mk(c.hoursText)), periods: c.periods ?? undefined };
  }
  if (c.address) enrichment.address = field(c.address, mk(c.address));
  if (c.rating != null) {
    const v = c.reviewCount != null ? `${c.rating} (${c.reviewCount} reviews)` : String(c.rating);
    enrichment.rating = field(v, mk(v));
  }

  // 1.5) No hours yet + Places available → look the business up for REAL hours
  // (+ website/rating). Covers CSV/OSM leads that never came through Places.
  if (!enrichment.officeHours && isPlacesConfigured()) {
    const pl = await placesLookup(c.companyName, c.city);
    if (pl) {
      const psrc = (value: string): FieldSource => ({ name: "places", url: pl.source.url, value, at: nowIso() });
      if (pl.hoursText) {
        enrichment.officeHours = { ...field(pl.hoursText, psrc(pl.hoursText)), periods: pl.periods ?? undefined };
      }
      if (!website && pl.website) website = pl.website;
      if (!enrichment.website && pl.website) enrichment.website = field(pl.website, psrc(pl.website));
      if (!enrichment.rating && pl.rating != null) {
        const v = pl.reviewCount != null ? `${pl.rating} (${pl.reviewCount} reviews)` : String(pl.rating);
        enrichment.rating = field(v, psrc(v));
      }
    }
  }

  // 2) Find a website if the source didn't include one.
  if (!website) website = await findWebsite(c.companyName, c.city);

  // 3) Scrape homepage + people pages; extract contact/email/social.
  let websiteText: string | null = null;
  if (website) {
    const html = await fetchHtml(website);
    if (html) {
      const home = scrape(html);
      let combined = home.text;
      let email = home.email;
      let peopleUrl = website;

      for (const url of peoplePages(html, website)) {
        const sub = await fetchHtml(url);
        if (!sub) continue;
        const s = scrape(sub);
        combined += "\n\n" + s.text;
        if (!email && s.email) email = s.email;
        if (/(team|about|staff|people|leadership|meet|founder|principal)/i.test(url)) peopleUrl = url;
      }
      websiteText = combined.slice(0, 9000);

      const webSrc: FieldSource = { name: "website", url: website, value: website, at: nowIso() };
      if (enrichment.website) enrichment.website.sources.push(webSrc);
      else enrichment.website = field(website, webSrc);

      if (home.social.length) {
        const v = home.social.join(", ");
        enrichment.social = field(v, { name: "website", url: website, value: v, at: nowIso() });
      }

      // Decision-maker via Haiku over the combined text.
      const dm = await extractDecisionMaker(combined, c.companyName);
      if (dm?.name) {
        enrichment.dmName = field(dm.name, { name: "website", url: peopleUrl, value: dm.name, at: nowIso() });
        if (dm.title) {
          enrichment.dmTitle = field(dm.title, { name: "website", url: peopleUrl, value: dm.title, at: nowIso() });
        }
        if (dm.email && !email) email = dm.email;
      }

      if (email) {
        enrichment.email = field(email, { name: "website", url: website, value: email, at: nowIso() });
      }
    }
  }

  return { enrichment, website: website ?? null, websiteText };
}

/**
 * Enrich a batch with bounded concurrency. Rejects are skipped (empty
 * enrichment). Returns Enriched items with verified flags computed.
 */
export async function enrichAll(items: Classified[]): Promise<Enriched[]> {
  const out: Enriched[] = new Array(items.length);
  let cursor = 0;
  const workers = Math.min(harvestConfig.scrapeConcurrency, items.length || 1);

  async function worker() {
    while (cursor < items.length) {
      const i = cursor++;
      const item = items[i];
      if (item.verdict === "reject") {
        out[i] = { ...item, enrichment: {}, websiteText: null };
        continue;
      }
      try {
        const { enrichment, website, websiteText } = await enrichCandidate(item);
        out[i] = {
          ...item,
          website: website ?? item.website,
          enrichment: verifyEnrichment(enrichment),
          websiteText,
        };
      } catch {
        out[i] = { ...item, enrichment: {}, websiteText: null };
      }
    }
  }

  await Promise.all(Array.from({ length: workers }, worker));
  return out;
}
