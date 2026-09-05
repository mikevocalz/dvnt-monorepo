/**
 * Client-side API for fetching the Live Surface payload from the Supabase Edge Function.
 */
import { supabase } from "@dvnt/app/lib/supabase/client";
import { getAuthToken } from "@dvnt/app/lib/auth-client";

import type { LiveSurfacePayload } from "./types";

const EDGE_FUNCTION_NAME = "live-surface";

/**
 * Fetch the live surface payload for the current user's location.
 * Optionally pass coordinates for weather data; omitting them skips weather.
 */
export async function fetchLiveSurface(opts?: {
  lat?: number;
  lng?: number;
  forecastAt?: string;
  /** Optional caller scope fence, checked after the token await before HTTP. */
  shouldContinue?: () => boolean;
}): Promise<LiveSurfacePayload | null> {
  try {
    const params: Record<string, string | number> = {};
    if (opts?.lat != null && opts?.lng != null) {
      params.lat = opts.lat;
      params.lng = opts.lng;
    }

    if (opts?.forecastAt) params.forecastAt = opts.forecastAt;
    const token = await getAuthToken();
    if (!token) {
      console.warn("[LiveSurface] No auth token available");
      return null;
    }

    if (opts?.shouldContinue && !opts.shouldContinue()) return null;
    const { data, error } = await supabase.functions.invoke(
      EDGE_FUNCTION_NAME,
      {
        body: params,
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    );

    if (error) {
      console.warn("[LiveSurface] Edge function error:", error.message);
      return null;
    }

    return (data?.data ?? data) as LiveSurfacePayload;
  } catch (e) {
    console.warn("[LiveSurface] fetchLiveSurface failed:", e);
    return null;
  }
}
