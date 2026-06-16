/**
 * Normalized Location Types
 * Shared location model for posts, events, and places
 */

export interface NormalizedLocation {
  // Core identifiers
  placeId: string;
  provider: "google" | "apple" | "foursquare";

  // Display
  name: string;
  formattedAddress: string;

  // Coordinates (WGS84)
  latitude: number;
  longitude: number;

  // Address components
  city?: string;
  state?: string;
  country?: string;
  countryCode?: string;
  postalCode?: string;
  neighborhood?: string;

  // Metadata
  category?: string;
  phoneNumber?: string;
  website?: string;
  rating?: number;
  viewport?: {
    northeast: { lat: number; lng: number };
    southwest: { lat: number; lng: number };
  };

  // Internal
  cachedAt?: number;
}

/**
 * Simplified location for list displays
 */
export interface LocationSummary {
  placeId: string;
  name: string;
  city?: string;
  latitude: number;
  longitude: number;
}

/**
 * Location with post count (for discovery)
 */
export interface LocationWithPosts extends LocationSummary {
  postCount: number;
  recentPostThumbnail?: string;
}

/**
 * Convert Google Places result to normalized location
 */
export function normalizeGooglePlace(
  data: any,
  details: any | null,
): NormalizedLocation {
  const geometry = details?.geometry;
  const location = geometry?.location;

  // Extract address components
  const components = details?.address_components || [];
  const getComponent = (type: string) =>
    components.find((c: any) => c.types.includes(type))?.long_name;
  const getComponentShort = (type: string) =>
    components.find((c: any) => c.types.includes(type))?.short_name;

  return {
    placeId: data.place_id || details?.place_id || "",
    provider: "google",
    name:
      details?.name ||
      data.structured_formatting?.main_text ||
      data.description?.split(",")[0] ||
      "Unknown",
    formattedAddress: details?.formatted_address || data.description || "",
    latitude: location?.lat || 0,
    longitude: location?.lng || 0,
    city: getComponent("locality") || getComponent("sublocality"),
    state: getComponent("administrative_area_level_1"),
    country: getComponent("country"),
    countryCode: getComponentShort("country"),
    postalCode: getComponent("postal_code"),
    neighborhood: getComponent("neighborhood"),
    category: details?.types?.[0],
    phoneNumber: details?.formatted_phone_number,
    website: details?.website,
    rating: details?.rating,
    viewport: geometry?.viewport,
    cachedAt: Date.now(),
  };
}

/**
 * Create a location summary from full location
 */
export function toLocationSummary(
  location: NormalizedLocation,
): LocationSummary {
  return {
    placeId: location.placeId,
    name: location.name,
    city: location.city,
    latitude: location.latitude,
    longitude: location.longitude,
  };
}

/**
 * Format location for display (compact)
 * "Madison Square Garden, New York"
 */
export function formatLocationCompact(location: NormalizedLocation): string {
  const parts = [location.name];
  if (location.city) parts.push(location.city);
  else if (location.formattedAddress) return location.formattedAddress;
  return parts.join(", ");
}

/**
 * Format coordinates for display
 */
export function formatCoordinates(lat: number, lng: number): string {
  return `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
}

/**
 * Check if location has valid coordinates
 */
export function hasValidCoordinates(
  location?: NormalizedLocation | null,
): boolean {
  if (!location) return false;
  return (
    typeof location.latitude === "number" &&
    typeof location.longitude === "number" &&
    !isNaN(location.latitude) &&
    !isNaN(location.longitude) &&
    location.latitude !== 0 &&
    location.longitude !== 0
  );
}

/**
 * Calculate distance between two coordinates in km (Haversine formula)
 */
export function calculateDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6371; // Earth's radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Schema for DB storage (snake_case for Supabase)
 */
export interface LocationDbSchema {
  place_id: string | null;
  location_name: string | null;
  location_formatted_address: string | null;
  location_lat: number | null;
  location_lng: number | null;
  location_city: string | null;
  location_country: string | null;
}

/**
 * Convert normalized location to DB schema
 */
export function toLocationDbSchema(
  location: NormalizedLocation | null,
): LocationDbSchema {
  if (!location) {
    return {
      place_id: null,
      location_name: null,
      location_formatted_address: null,
      location_lat: null,
      location_lng: null,
      location_city: null,
      location_country: null,
    };
  }
  return {
    place_id: location.placeId || null,
    location_name: location.name || null,
    location_formatted_address: location.formattedAddress || null,
    location_lat: location.latitude ?? null,
    location_lng: location.longitude ?? null,
    location_city: location.city ?? null,
    location_country: location.country ?? null,
  };
}

/**
 * Convert DB schema to normalized location
 */
export function fromLocationDbSchema(
  db: Partial<LocationDbSchema>,
): NormalizedLocation | null {
  if (!db.place_id || !db.location_lat || !db.location_lng) {
    return null;
  }
  return {
    placeId: db.place_id,
    provider: "google",
    name: db.location_name || db.place_id,
    formattedAddress: db.location_formatted_address || "",
    latitude: db.location_lat,
    longitude: db.location_lng,
    city: db.location_city || undefined,
    country: db.location_country || undefined,
  };
}
