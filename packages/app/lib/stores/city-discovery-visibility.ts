/**
 * City discovery visibility — "can other members see which city I'm in".
 *
 * This is NOT the same question as "how do I find events". `locationMode`
 * answers the second one and has always defaulted to on, because finding events
 * is the reason the member opened the app. Being findable by other people is a
 * different ask with a different default: off, always, until the member says
 * otherwise and says for how long.
 *
 * The grant carries a city and an end time. No coordinates, no event id, no
 * ticket id — there is nowhere in this shape to put one, which is the point.
 *
 * ponytail: the grant is device-local. Nothing publishes it to other members
 * yet, so today the switch only records the member's answer. Whatever server
 * surface consumes it later must read through `readCityVisibility` rather than
 * the raw `cityVisibility` field, and must send the city id alone.
 *
 * Expiry is enforced on read. A phone that slept through the end time, had its
 * clock moved, or was reinstalled from a backup still reads an old grant as
 * off, because `readCityVisibility` compares against the clock every time
 * instead of trusting a timer that may never have fired.
 */

export type LocationMode = "city" | "device" | "hidden";

export interface CityVisibilityGrant {
  cityId: number;
  cityName: string;
  /** Epoch ms. The grant is off at this instant and after it. */
  expiresAt: number;
}

export type VisibilityDurationId = "1h" | "24h" | "7d";

export const VISIBILITY_DURATIONS: ReadonlyArray<{
  id: VisibilityDurationId;
  label: string;
  ms: number;
}> = [
  { id: "1h", label: "1 hour", ms: 60 * 60 * 1000 },
  { id: "24h", label: "24 hours", ms: 24 * 60 * 60 * 1000 },
  { id: "7d", label: "7 days", ms: 7 * 24 * 60 * 60 * 1000 },
];

/** Shortest window wins the default: the least the member can accidentally give away. */
export const DEFAULT_VISIBILITY_DURATION_ID: VisibilityDurationId = "1h";

export function visibilityDurationMs(id: VisibilityDurationId): number {
  return (
    VISIBILITY_DURATIONS.find((d) => d.id === id)?.ms ??
    VISIBILITY_DURATIONS[0].ms
  );
}

export function readVisibilityDurationId(value: unknown): VisibilityDurationId {
  return VISIBILITY_DURATIONS.some((d) => d.id === value)
    ? (value as VisibilityDurationId)
    : DEFAULT_VISIBILITY_DURATION_ID;
}

/**
 * The only way a grant becomes visible to a caller. Anything that is not a
 * well-formed, unexpired grant reads as off — including a half-written MMKV
 * blob, a grant from an older app version, and a grant whose end time already
 * passed while the app was closed.
 */
export function readCityVisibility(
  value: unknown,
  now: number,
): CityVisibilityGrant | null {
  if (!value || typeof value !== "object") return null;
  const g = value as Partial<CityVisibilityGrant>;
  if (typeof g.cityId !== "number" || !Number.isFinite(g.cityId)) return null;
  if (typeof g.cityName !== "string" || g.cityName.length === 0) return null;
  if (typeof g.expiresAt !== "number" || !Number.isFinite(g.expiresAt)) {
    return null;
  }
  if (g.expiresAt <= now) return null;
  return { cityId: g.cityId, cityName: g.cityName, expiresAt: g.expiresAt };
}

/** State the two settings share, so their independence is testable on its own. */
export interface DiscoveryVisibilityState {
  locationMode: LocationMode;
  cityVisibility: CityVisibilityGrant | null;
}

/**
 * Changing how events are found. Returns the visibility grant untouched — the
 * invariant this function exists to hold is that no value of `mode`, including
 * `"device"`, can start or extend a grant.
 */
export function applyFindEventsMode<T extends DiscoveryVisibilityState>(
  state: T,
  mode: LocationMode,
): T {
  return { ...state, locationMode: mode };
}

/** Start or replace a grant. Always bounded: there is no "forever" argument. */
export function applyCityVisibility<T extends DiscoveryVisibilityState>(
  state: T,
  city: { id: number; name: string },
  durationMs: number,
  now: number,
): T {
  return {
    ...state,
    cityVisibility: {
      cityId: city.id,
      cityName: city.name,
      expiresAt: now + durationMs,
    },
  };
}

/** One-tap revoke. Clears the grant outright rather than back-dating it. */
export function applyRevokeCityVisibility<T extends DiscoveryVisibilityState>(
  state: T,
): T {
  return { ...state, cityVisibility: null };
}

/**
 * Shared so the native and web settings screens cannot drift into saying two
 * different things about who can see what.
 */
export const CITY_VISIBILITY_COPY = {
  sectionTitle: "City visibility",
  toggleLabel: "Let members see the city I'm in",
  toggleDescription:
    "Other members see the city name you picked. They do not see your address, your position on a map, or any event you have a ticket to.",
  durationLabel: "Turn off after",
  noCity: "Pick a city on the Events screen first.",
  revoke: "Turn off now",
  offNote:
    "Off. Finding events near you is a separate setting and does not turn this on.",
} as const;

/** "4:12 PM" / "Sep 23, 4:12 PM" — whichever the end time needs. */
export function formatVisibilityExpiry(expiresAt: number, now: number): string {
  const end = new Date(expiresAt);
  const time = end.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
  const sameDay = new Date(now).toDateString() === end.toDateString();
  if (sameDay) return time;
  const day = end.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return `${day}, ${time}`;
}
