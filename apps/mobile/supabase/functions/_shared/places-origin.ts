export type PlacesOrigin = { latitude: number; longitude: number };

/**
 * Validate the optional `origin` a client sends to places-autocomplete.
 * Google's Autocomplete (New) uses it only to compute each prediction's
 * straight-line `distanceMeters`; it does not affect ranking. Anything that is
 * not a pair of finite, in-range numbers is ignored (null), so a bad origin
 * drops the distance line instead of failing the search.
 */
export function parsePlacesOrigin(value: unknown): PlacesOrigin | null {
  if (!value || typeof value !== "object") return null;
  const { latitude, longitude } = value as Record<string, unknown>;
  if (typeof latitude !== "number" || typeof longitude !== "number") return null;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (latitude < -90 || latitude > 90) return null;
  if (longitude < -180 || longitude > 180) return null;
  return { latitude, longitude };
}

/** Google returns distanceMeters as an integer; pass it through only when sane. */
export function readDistanceMeters(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}
