/**
 * TypeScript types for the DVNT Live Surface system.
 * These mirror the payload shape from the `live-surface` Supabase Edge Function
 * and the data consumed by iOS widgets / Live Activities.
 */

// ── Edge Function Response ──

export interface LiveSurfaceTile1 {
  eventId: string | null;
  title: string;
  startAt: string | null;
  venueName: string | null;
  city: string | null;
  category: string | null;
  heroThumbUrl: string | null;
  isUpcoming: boolean;
  deepLink: string;
  attendeeCount: number | null;
}

export interface LiveSurfaceTile3Item {
  eventId: string;
  title: string;
  startAt: string;
  venueName: string | null;
  heroThumbUrl: string | null;
  deepLink: string;
}

export interface LiveSurfaceTile3 {
  items: LiveSurfaceTile3Item[];
  seeAllDeepLink: string;
}

export interface LiveSurfaceWeather {
  icon: string | null;
  tempF: number | null;
  label: string | null;
  hiF?: number | null;
  loF?: number | null;
  precipPct?: number | null;
  feelsLikeF?: number | null;
}

export interface LiveSurfacePayload {
  generatedAt: string;
  tile1: LiveSurfaceTile1;
  tile2: unknown; // Not used by widgets in v2
  tile3: LiveSurfaceTile3;
  weather: LiveSurfaceWeather | null;
}

// ── Native Bridge Types ──

export interface LiveActivityState {
  isEnabled: boolean;
  isActive: boolean;
}
