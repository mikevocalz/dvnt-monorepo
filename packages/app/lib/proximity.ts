/**
 * Member-to-member proximity — city-level only, on purpose.
 *
 * What we know about a member is the city they typed on their profile, and
 * what we know about the viewer is a device fix or a picked city. Neither is
 * a coordinate owned by the other person: users.device_lat/device_lng stay
 * unwritten, and city-discovery-visibility ships no coordinates because
 * "being findable" is a different consent than "finding events". So this
 * module answers "how far is their stated city from me", nothing finer.
 *
 * cityVisibility grants are device-local today (see city-discovery-visibility.ts
 * — "nothing publishes it to other members yet"), so the label is driven by the
 * profile's self-reported `location` text, which is already public on the
 * profile. A profile with no resolvable city gets no badge rather than a
 * guessed distance.
 */
import { calculateDistance } from "@dvnt/app/lib/types/location.ts";

export interface CityPoint {
  name: string;
  lat: number;
  lng: number;
}

export interface ViewerPosition {
  lat: number;
  lng: number;
  /** Set when the position came from a named city rather than raw coords. */
  cityName?: string;
}

const KM_PER_MILE = 0.621371;

/**
 * Well-known names members actually type for a city in the table —
 * "NYC", "Harlem", "ATL" are not guesses, they are the city. Only entries
 * that cannot honestly mean somewhere else belong here: "DC"/"DMV" point at
 * no city row today, so they stay out rather than landing on the wrong pin.
 */
const CITY_ALIASES: Record<string, string> = {
  nyc: "New York",
  "new york city": "New York",
  manhattan: "New York",
  harlem: "New York",
  soho: "New York",
  tribeca: "New York",
  chelsea: "New York",
  midtown: "New York",
  brooklyn: "Brooklyn",
  bk: "Brooklyn",
  williamsburg: "Brooklyn",
  bushwick: "Brooklyn",
  bedstuy: "Brooklyn",
  greenpoint: "Brooklyn",
  atl: "Atlanta",
  la: "Los Angeles",
  sf: "San Francisco",
  chi: "Chicago",
  philly: "Philadelphia",
  htx: "Houston",
  mia: "Miami",
};

/** "Atlanta, GA" -> "atlanta", "Washington D.C." -> "washington dc". */
export function normalizeLocationText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[.'"]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Resolve free-text location to a known city centroid. Matches the segment
 * before the first comma, or the whole string, against `city.name` with a
 * trailing-token allowance so "Washington D.C." and "Atlanta GA" both reach
 * "Washington"/"Atlanta". Anything else (a state, slang like "HTX", a blank)
 * returns undefined — no fabricated distance.
 */
export function matchCity(
  locationText: string | null | undefined,
  cities: ReadonlyArray<CityPoint>,
): CityPoint | undefined {
  if (!locationText) return undefined;
  const candidates = [
    normalizeLocationText(locationText.split(",")[0]),
    normalizeLocationText(locationText),
  ].filter(Boolean);
  for (const norm of candidates) {
    const aliasTarget = CITY_ALIASES[norm];
    const hit = cities.find((c) => {
      const name = normalizeLocationText(c.name);
      return (
        norm === name ||
        norm.startsWith(`${name} `) ||
        (aliasTarget != null && name === normalizeLocationText(aliasTarget))
      );
    });
    if (hit) return hit;
  }
  return undefined;
}

export function distanceMiles(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  return calculateDistance(lat1, lng1, lat2, lng2) * KM_PER_MILE;
}

/** "0.4 miles away" / "24 miles away" — one decimal under ten. */
export function formatMiles(miles: number): string {
  const rounded = miles < 10 ? Math.round(miles * 10) / 10 : Math.round(miles);
  return `${rounded} miles away`;
}

const METERS_PER_MILE = 1609.344;

export function metersToMiles(meters: number): number {
  return meters / METERS_PER_MILE;
}

/**
 * Distance line under a place search result, measured from the member's
 * stored city. Returns null (render nothing) when there is no city to measure
 * from or the provider sent no usable distance. A place a few meters from the
 * city centroid reads "0.1 miles away" rather than "0 miles away".
 */
export function placeDistanceLabel(
  distanceMeters: number | null | undefined,
  origin: { lat: number; lng: number } | null | undefined,
): string | null {
  if (!origin) return null;
  if (typeof distanceMeters !== "number" || !Number.isFinite(distanceMeters)) {
    return null;
  }
  if (distanceMeters < 0) return null;
  return formatMiles(Math.max(metersToMiles(distanceMeters), 0.1));
}

/**
 * The badge a profile can honestly show. Same named city collapses to
 * "In {City}" — a centroid-to-centroid figure between two points inside one
 * city would pretend to a precision we do not have.
 */
export function proximityLabel(
  viewer: ViewerPosition,
  profileCity: CityPoint,
): string {
  if (
    viewer.cityName &&
    normalizeLocationText(viewer.cityName) === normalizeLocationText(profileCity.name)
  ) {
    return `In ${profileCity.name}`;
  }
  const miles = distanceMiles(
    viewer.lat,
    viewer.lng,
    profileCity.lat,
    profileCity.lng,
  );
  if (miles < 0.15) return `In ${profileCity.name}`;
  return formatMiles(miles);
}

/**
 * Where the viewer is, best source first: a live device fix, then the city
 * they picked, then the city they typed on their own profile. Returns null
 * when none of them resolve — the badge hides rather than lies.
 */
export function resolveViewerPosition(opts: {
  deviceLat?: number | null;
  deviceLng?: number | null;
  activeCity?: CityPoint | null;
  viewerLocationText?: string | null;
  cities: ReadonlyArray<CityPoint>;
}): ViewerPosition | null {
  const { deviceLat, deviceLng, activeCity, viewerLocationText, cities } = opts;
  if (
    typeof deviceLat === "number" &&
    typeof deviceLng === "number" &&
    deviceLat !== 0 &&
    deviceLng !== 0
  ) {
    return { lat: deviceLat, lng: deviceLng };
  }
  if (activeCity) {
    return { lat: activeCity.lat, lng: activeCity.lng, cityName: activeCity.name };
  }
  const own = matchCity(viewerLocationText, cities);
  if (own) return { lat: own.lat, lng: own.lng, cityName: own.name };
  return null;
}
