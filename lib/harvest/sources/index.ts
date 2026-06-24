/**
 * Discovery orchestration. Picks the best available source — Google Places when
 * a key is set (paginated), else free OpenStreetMap (one shot per area) — sweeps
 * locations starting from the saved cursor, and returns up to `max` candidates
 * plus the advanced cursor. Dedup happens downstream (ingest), so overlap is fine.
 */
import { isPlacesConfigured } from "../config";
import { placesSearch } from "./places";
import { osmSearch } from "./osm";
import type { Candidate, DiscoverResult, HarvestSearch } from "../types";

export async function discover(
  search: HarvestSearch,
  opts: { max: number },
): Promise<DiscoverResult> {
  const locations = [search.location, ...(search.extraLocations ?? [])].filter(Boolean);
  const term = (search.keywords ?? "").trim() || "property management";

  let locationIndex = search.cursor?.locationIndex ?? 0;
  let pageToken = search.cursor?.pageToken ?? null;
  if (locationIndex >= locations.length) {
    locationIndex = 0;
    pageToken = null;
  }

  const usePlaces = isPlacesConfigured();
  const sourceName = usePlaces ? "places" : "osm";
  const candidates: Candidate[] = [];
  const errors: string[] = [];

  while (candidates.length < opts.max && locationIndex < locations.length) {
    const loc = locations[locationIndex];
    if (usePlaces) {
      try {
        const page = await placesSearch({ textQuery: `${term} in ${loc}`, pageToken });
        candidates.push(...page.candidates);
        if (page.nextPageToken) {
          pageToken = page.nextPageToken; // more pages for this location
        } else {
          locationIndex++;
          pageToken = null;
        }
      } catch (e) {
        errors.push(`places[${loc}]: ${e instanceof Error ? e.message : String(e)}`);
        locationIndex++;
        pageToken = null;
      }
    } else {
      // OSM returns the whole area at once — consume the location and advance.
      const found = await osmSearch(loc, search.radiusMeters);
      if (!found.length) errors.push(`osm[${loc}]: no results (sparse coverage?)`);
      candidates.push(...found);
      locationIndex++;
      pageToken = null;
    }
  }

  const exhausted = locationIndex >= locations.length;
  const nextCursor = exhausted
    ? { locationIndex: 0, pageToken: null, done: false }
    : { locationIndex, pageToken, done: false };

  return { candidates, errors, sourceName, nextCursor };
}
