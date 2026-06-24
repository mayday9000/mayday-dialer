/**
 * OpenStreetMap discovery — completely free, no key. Geocodes the location with
 * Nominatim, then queries Overpass for property-management / estate-agent POIs
 * around it. Coverage of small US firms is thin, but when present OSM often has
 * website + hours tagged. The zero-setup starter source.
 *
 * Respect OSM usage policy: descriptive User-Agent, low volume, one shot/area.
 */
import type { Candidate } from "../types";

const NOMINATIM = "https://nominatim.openstreetmap.org/search";
const OVERPASS = "https://overpass-api.de/api/interpreter";
const UA = "MaydayAIDialer/1.0 (lead research; contact: masondavisai@gmail.com)";

async function geocode(location: string): Promise<{ lat: number; lon: number } | null> {
  try {
    const url = `${NOMINATIM}?q=${encodeURIComponent(location)}&format=jsonv2&limit=1&countrycodes=us`;
    const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
    if (!res.ok) return null;
    const data = (await res.json()) as { lat?: string; lon?: string }[];
    const first = data[0];
    if (!first?.lat || !first?.lon) return null;
    return { lat: parseFloat(first.lat), lon: parseFloat(first.lon) };
  } catch {
    return null;
  }
}

type OverpassEl = {
  type: string;
  id: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
};

function mapElement(el: OverpassEl): Candidate | null {
  const t = el.tags ?? {};
  const name = (t.name ?? "").trim();
  if (!name) return null;
  const address = [t["addr:housenumber"], t["addr:street"]].filter(Boolean).join(" ") || null;
  return {
    companyName: name,
    phoneRaw: t.phone || t["contact:phone"] || null,
    website: t.website || t["contact:website"] || null,
    hoursText: t.opening_hours || null,
    periods: null, // OSM opening_hours is a raw string; not parsed to periods
    address,
    city: t["addr:city"] || null,
    state: t["addr:state"] || null,
    zip: t["addr:postcode"] || null,
    categories: [t.office].filter(Boolean) as string[],
    rating: null,
    reviewCount: null,
    reviews: [], // OSM has no reviews
    source: { name: "osm", url: `https://www.openstreetmap.org/${el.type}/${el.id}` },
  };
}

/** All matching businesses around a location (one shot — OSM isn't paginated). */
export async function osmSearch(location: string, radiusMeters: number): Promise<Candidate[]> {
  const geo = await geocode(location);
  if (!geo) return [];

  const r = Math.min(Math.max(radiusMeters, 1000), 50000);
  const query = `[out:json][timeout:25];
(
  nwr(around:${r},${geo.lat},${geo.lon})["office"="property_management"];
  nwr(around:${r},${geo.lat},${geo.lon})["office"="estate_agent"];
);
out center tags 100;`;

  try {
    const res = await fetch(OVERPASS, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": UA },
      body: `data=${encodeURIComponent(query)}`,
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { elements?: OverpassEl[] };
    return (data.elements ?? []).map(mapElement).filter((c): c is Candidate => c !== null);
  } catch {
    return [];
  }
}
