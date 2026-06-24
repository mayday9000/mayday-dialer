/**
 * Google Places API (New) — Text Search. Super cheap (generous free monthly
 * tier), instant key, and returns website + real office hours + phone in one
 * call. Used as the primary discovery source when GOOGLE_PLACES_API_KEY is set.
 *
 * Docs: https://developers.google.com/maps/documentation/places/web-service/text-search
 */
import { harvestConfig } from "../config";
import type { Candidate } from "../types";
import type { DayPeriod, LeadReview } from "../../db/schema";
import { normalizeName } from "../match";

const SEARCH_URL = "https://places.googleapis.com/v1/places:searchText";

// Field mask drives both the response shape and billing SKU. This set includes
// website + hours (Enterprise SKU), which is the whole point of using Places.
const FIELD_MASK = [
  "places.displayName",
  "places.nationalPhoneNumber",
  "places.internationalPhoneNumber",
  "places.websiteUri",
  "places.regularOpeningHours.weekdayDescriptions",
  "places.regularOpeningHours.periods",
  "places.rating",
  "places.userRatingCount",
  "places.formattedAddress",
  "places.addressComponents",
  "places.businessStatus",
  "places.googleMapsUri",
  "places.types",
  // Customer reviews (up to ~5 "most relevant") — raw ammo for Key Notes.
  // NB: requesting reviews bumps the call to the Enterprise+Atmosphere SKU.
  "places.reviews",
  "nextPageToken",
].join(",");

type PlacesAddressComponent = { longText?: string; shortText?: string; types?: string[] };
type PlacesTimePoint = { day?: number; hour?: number; minute?: number };
type PlacesPeriod = { open?: PlacesTimePoint; close?: PlacesTimePoint };
type PlacesReview = {
  rating?: number;
  text?: { text?: string };
  originalText?: { text?: string };
  authorAttribution?: { displayName?: string };
  relativePublishTimeDescription?: string;
  publishTime?: string;
};
type Place = {
  displayName?: { text?: string };
  nationalPhoneNumber?: string;
  internationalPhoneNumber?: string;
  websiteUri?: string;
  regularOpeningHours?: { weekdayDescriptions?: string[]; periods?: PlacesPeriod[] };
  rating?: number;
  userRatingCount?: number;
  formattedAddress?: string;
  addressComponents?: PlacesAddressComponent[];
  businessStatus?: string;
  googleMapsUri?: string;
  types?: string[];
  reviews?: PlacesReview[];
};

/** Map Places review objects to our stored LeadReview shape (text only). */
function toReviews(reviews?: PlacesReview[]): LeadReview[] {
  return (reviews ?? [])
    .map((r) => ({
      source: "places",
      author: r.authorAttribution?.displayName ?? null,
      rating: typeof r.rating === "number" ? r.rating : null,
      text: (r.text?.text ?? r.originalText?.text ?? "").trim(),
      relativeTime: r.relativePublishTimeDescription ?? null,
      publishedAt: r.publishTime ?? null,
    }))
    .filter((r) => r.text);
}

function component(components: PlacesAddressComponent[] | undefined, type: string, short = false) {
  const c = (components ?? []).find((x) => x.types?.includes(type));
  return (short ? c?.shortText : c?.longText) ?? null;
}

const hhmm = (t?: PlacesTimePoint) =>
  `${String(t?.hour ?? 0).padStart(2, "0")}${String(t?.minute ?? 0).padStart(2, "0")}`;

function toPeriods(p?: PlacesPeriod[]): DayPeriod[] | null {
  if (!p?.length) return null;
  const out: DayPeriod[] = [];
  for (const per of p) {
    if (per.open?.day == null) continue;
    out.push({
      day: per.open.day,
      open: hhmm(per.open),
      // No close => open 24h that day.
      close: per.close ? hhmm(per.close) : "2359",
    });
  }
  return out.length ? out : null;
}

function mapPlace(p: Place): Candidate | null {
  const name = p.displayName?.text?.trim();
  if (!name) return null;
  if (p.businessStatus === "CLOSED_PERMANENTLY") return null;
  return {
    companyName: name,
    phoneRaw: p.nationalPhoneNumber || p.internationalPhoneNumber || null,
    website: p.websiteUri || null,
    hoursText: p.regularOpeningHours?.weekdayDescriptions?.join("; ") || null,
    periods: toPeriods(p.regularOpeningHours?.periods),
    address: p.formattedAddress || null,
    city: component(p.addressComponents, "locality"),
    state: component(p.addressComponents, "administrative_area_level_1", true),
    zip: component(p.addressComponents, "postal_code"),
    categories: p.types ?? [],
    rating: typeof p.rating === "number" ? p.rating : null,
    reviewCount: typeof p.userRatingCount === "number" ? p.userRatingCount : null,
    reviews: toReviews(p.reviews),
    source: { name: "places", url: p.googleMapsUri || null },
  };
}

export type PlacesPage = { candidates: Candidate[]; nextPageToken: string | null };

/** One page (max 20). Throws on misconfig / API error (caller logs + continues). */
export async function placesSearch(params: {
  textQuery: string;
  pageToken?: string | null;
}): Promise<PlacesPage> {
  const key = harvestConfig.googlePlacesApiKey;
  if (!key) throw new Error("GOOGLE_PLACES_API_KEY not set");

  const body: Record<string, unknown> = {
    textQuery: params.textQuery,
    pageSize: 20,
    regionCode: "US",
  };
  if (params.pageToken) body.pageToken = params.pageToken;

  const res = await fetch(SEARCH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": key,
      "X-Goog-FieldMask": FIELD_MASK,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Places ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = (await res.json()) as { places?: Place[]; nextPageToken?: string };
  const candidates = (data.places ?? [])
    .map(mapPlace)
    .filter((c): c is Candidate => c !== null);
  return { candidates, nextPageToken: data.nextPageToken || null };
}

/**
 * Look up ONE business's real hours/website/rating by name + city — used to
 * enrich existing leads (CSV/OSM) that never came through Places discovery.
 * Returns the top match only if its name shares a distinctive token, so we
 * never attach the wrong business's hours. Null on no confident match.
 */
export async function placesLookup(name: string, city: string | null): Promise<Candidate | null> {
  if (!harvestConfig.googlePlacesApiKey || !name.trim()) return null;
  let page: PlacesPage;
  try {
    page = await placesSearch({ textQuery: `${name} ${city ?? ""}`.trim() });
  } catch {
    return null;
  }
  const nameTokens = new Set(normalizeName(name).split(" ").filter((t) => t.length >= 4));
  for (const cand of page.candidates) {
    const candTokens = new Set(normalizeName(cand.companyName).split(" "));
    if (nameTokens.size === 0 || [...nameTokens].some((t) => candTokens.has(t))) return cand;
  }
  return null;
}
