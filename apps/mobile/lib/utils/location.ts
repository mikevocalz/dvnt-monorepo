/**
 * Location Utilities
 * Helpers for location operations, directions, and maps
 */

import { Platform, Linking, Alert } from "react-native";
import type { NormalizedLocation } from "@/lib/types/location";

/**
 * Open native directions to a location
 * Falls back from Apple Maps → Google Maps → Web
 */
export async function openDirections(
  location: NormalizedLocation,
  options: {
    label?: string;
    sourceLat?: number;
    sourceLng?: number;
  } = {},
): Promise<boolean> {
  const { latitude, longitude, name } = location;
  const label = encodeURIComponent(options.label || name || "Destination");
  const coords = `${latitude},${longitude}`;

  // Build URL schemes
  const urls: string[] = [];

  if (Platform.OS === "ios") {
    // Apple Maps (iOS native)
    // Format: http://maps.apple.com/?daddr=lat,lng&ll=lat,lng&q=name
    urls.push(`http://maps.apple.com/?daddr=${coords}&q=${label}`);

    // Google Maps iOS app
    // Format: comgooglemaps://?daddr=lat,lng&directionsmode=driving
    urls.push(
      `comgooglemaps://?daddr=${coords}&directionsmode=driving&q=${label}`,
    );

    // Google Maps web fallback
    urls.push(`https://www.google.com/maps/dir/?api=1&destination=${coords}`);
  } else {
    // Android - Google Maps intent
    // Format: https://www.google.com/maps/dir/?api=1&destination=lat,lng
    urls.push(`https://www.google.com/maps/dir/?api=1&destination=${coords}`);

    // Geo intent as fallback
    urls.push(
      `geo:${latitude},${longitude}?q=${latitude},${longitude}(${label})`,
    );
  }

  // Try each URL in order
  for (const url of urls) {
    try {
      const supported = await Linking.canOpenURL(url);
      if (supported) {
        await Linking.openURL(url);
        return true;
      }
    } catch (err) {
      console.warn("[Location] Failed to open URL:", url, err);
    }
  }

  // All failed
  Alert.alert(
    "Directions Unavailable",
    "Could not open maps. Please try again or use another app.",
    [{ text: "OK" }],
  );
  return false;
}

/**
 * Open a location in the native map app (view mode, not directions)
 */
export async function openMapView(
  location: NormalizedLocation,
): Promise<boolean> {
  const { latitude, longitude, name } = location;
  const label = encodeURIComponent(name || "Location");
  const coords = `${latitude},${longitude}`;

  const urls: string[] = [];

  if (Platform.OS === "ios") {
    // Apple Maps
    urls.push(`http://maps.apple.com/?ll=${coords}&q=${label}`);
    // Google Maps
    urls.push(`comgooglemaps://?center=${coords}&q=${label}`);
  } else {
    // Google Maps
    urls.push(`https://www.google.com/maps/search/?api=1&query=${coords}`);
    // Geo intent
    urls.push(
      `geo:${latitude},${longitude}?q=${latitude},${longitude}(${label})`,
    );
  }

  for (const url of urls) {
    try {
      const supported = await Linking.canOpenURL(url);
      if (supported) {
        await Linking.openURL(url);
        return true;
      }
    } catch (err) {
      console.warn("[Location] Failed to open URL:", url, err);
    }
  }

  return false;
}

/**
 * Generate a static map image URL (for previews)
 * Uses Google Maps Static API (requires API key)
 */
export function getStaticMapUrl(
  lat: number,
  lng: number,
  options: {
    width?: number;
    height?: number;
    zoom?: number;
    marker?: boolean;
  } = {},
): string {
  const { width = 600, height = 300, zoom = 15, marker = true } = options;

  const apiKey = process.env.EXPO_PUBLIC_GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    console.warn("[Location] No Google API key for static maps");
    return "";
  }

  const params = new URLSearchParams({
    center: `${lat},${lng}`,
    zoom: String(zoom),
    size: `${width}x${height}`,
    maptype: "roadmap",
    key: apiKey,
  });

  if (marker) {
    params.append("markers", `color:red|${lat},${lng}`);
  }

  return `https://maps.googleapis.com/maps/api/staticmap?${params.toString()}`;
}

/**
 * Check if location has valid coordinates
 */
export function hasValidCoordinates(
  location?: { latitude?: number; longitude?: number } | null,
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
 * Debounce helper for search inputs
 */
export function debounce<T extends (...args: any[]) => void>(
  fn: T,
  delay: number,
): (...args: Parameters<T>) => void {
  let timeoutId: ReturnType<typeof setTimeout>;
  return (...args: Parameters<T>) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), delay);
  };
}

/**
 * Persist recent places to MMKV (for quick access)
 * Key: 'recent_places'
 */
const RECENT_PLACES_KEY = "recent_places";
const MAX_RECENT_PLACES = 10;

export function getRecentPlaces(): NormalizedLocation[] {
  try {
    // Dynamic import to avoid issues if MMKV not available
    const { MMKV } = require("react-native-mmkv");
    const storage = new MMKV({ id: "dvnt-location-storage" });
    const data = storage.getString(RECENT_PLACES_KEY);
    if (data) {
      const parsed = JSON.parse(data);
      return Array.isArray(parsed) ? parsed : [];
    }
  } catch (err) {
    console.warn("[Location] Failed to get recent places:", err);
  }
  return [];
}

export function addRecentPlace(place: NormalizedLocation): void {
  try {
    const { MMKV } = require("react-native-mmkv");
    const storage = new MMKV({ id: "dvnt-location-storage" });

    const recent = getRecentPlaces();

    // Remove duplicate if exists
    const filtered = recent.filter((p) => p.placeId !== place.placeId);

    // Add to front
    filtered.unshift(place);

    // Keep only max
    const trimmed = filtered.slice(0, MAX_RECENT_PLACES);

    storage.set(RECENT_PLACES_KEY, JSON.stringify(trimmed));
  } catch (err) {
    console.warn("[Location] Failed to save recent place:", err);
  }
}

export function clearRecentPlaces(): void {
  try {
    const { MMKV } = require("react-native-mmkv");
    const storage = new MMKV({ id: "dvnt-location-storage" });
    storage.delete(RECENT_PLACES_KEY);
  } catch (err) {
    console.warn("[Location] Failed to clear recent places:", err);
  }
}

/**
 * Parse a loose location string (best effort)
 * Used for backfilling legacy posts
 */
export function parseLooseLocation(location: string): {
  name?: string;
  city?: string;
} {
  if (!location || typeof location !== "string") {
    return {};
  }

  // Common patterns:
  // "Madison Square Garden, New York, NY"
  // "Brooklyn Bridge Park"
  // "Times Square"

  const parts = location
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);

  if (parts.length >= 2) {
    return {
      name: parts[0],
      city: parts[1],
    };
  }

  return { name: parts[0] };
}

/**
 * Compare two locations for equality (by placeId or coordinates)
 */
export function locationsEqual(
  a: NormalizedLocation | null,
  b: NormalizedLocation | null,
): boolean {
  if (!a || !b) return false;

  // Prefer placeId comparison
  if (a.placeId && b.placeId) {
    return a.placeId === b.placeId;
  }

  // Fall back to coordinates (within 10m tolerance)
  const tolerance = 0.0001; // ~11 meters
  return (
    Math.abs(a.latitude - b.latitude) < tolerance &&
    Math.abs(a.longitude - b.longitude) < tolerance
  );
}
