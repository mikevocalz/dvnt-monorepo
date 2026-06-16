/**
 * Client-side geocoding via OpenStreetMap Nominatim (free, no API key).
 * Results are persisted in MMKV so addresses are only geocoded once per app
 * install. Cache key is a simple djb2 hash of the normalized address string.
 */

import { mmkv } from "@/lib/mmkv-zustand";

const CACHE_PREFIX = "geocode_";
const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";

export interface GeoCoords {
  lat: number;
  lng: number;
}

function addressKey(address: string): string {
  const normalized = address.trim().toLowerCase().replace(/\s+/g, " ");
  let hash = 5381;
  for (let i = 0; i < normalized.length; i++) {
    hash = (hash * 33) ^ normalized.charCodeAt(i);
    hash = hash >>> 0;
  }
  return `${CACHE_PREFIX}${hash}`;
}

export async function geocodeAddress(address: string): Promise<GeoCoords | null> {
  if (!address?.trim()) return null;

  const cacheKey = addressKey(address);
  const cached = mmkv.getString(cacheKey);
  if (cached) {
    try {
      return JSON.parse(cached) as GeoCoords;
    } catch {
      mmkv.remove(cacheKey);
    }
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    let resp: Response;
    try {
      resp = await fetch(
        `${NOMINATIM_URL}?q=${encodeURIComponent(address)}&format=json&limit=1`,
        {
          signal: controller.signal,
          headers: { "Accept-Language": "en", "User-Agent": "DVNT/1.0" },
        },
      );
    } finally {
      clearTimeout(timeout);
    }

    if (!resp.ok) {
      if (__DEV__) console.warn("[Geocode] Nominatim error:", resp.status, address);
      return null;
    }

    const results = await resp.json();
    if (!Array.isArray(results) || results.length === 0) {
      if (__DEV__) console.log("[Geocode] No results for:", address);
      return null;
    }

    const { lat, lon } = results[0];
    const coords: GeoCoords = { lat: Number(lat), lng: Number(lon) };
    mmkv.set(cacheKey, JSON.stringify(coords));
    if (__DEV__) console.log("[Geocode] Geocoded:", address, "→", coords);
    return coords;
  } catch (err) {
    if (__DEV__) console.warn("[Geocode] Failed for:", address, err);
    return null;
  }
}
