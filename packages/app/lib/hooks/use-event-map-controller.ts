/**
 * useEventMapController
 *
 * Single source of truth for the events detached map sheet.
 * Owns: geocoding, nearest-event computation, viewport settling.
 *
 * Design contract:
 * - Returns `isReady=false` until we have a deterministic viewport.
 * - Viewport is computed ONCE and then frozen — no camera jumps after settle.
 * - Geocoding is fire-and-forget, tracked via a ref to prevent duplicate runs.
 * - All derived values are memoized with stable primitive dependencies.
 */

import { useMemo, useRef, useEffect, useState, useCallback } from "react";
import { useEventsLocationStore } from "@dvnt/app/lib/stores/events-location-store";
import { geocodeAddress } from "@dvnt/app/lib/utils/geocode";
import type { Event } from "@dvnt/app/lib/hooks/use-events";
import type { DvntMapMarker } from "@dvnt/app/src/components/map";

// ── Haversine distance ────────────────────────────────────────────────────────

function distKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── Viewport computation ──────────────────────────────────────────────────────

export interface MapViewport {
  centerLng: number;
  centerLat: number;
  zoom: number;
}

const NYC: MapViewport = { centerLng: -73.9857, centerLat: 40.7484, zoom: 12 };

function zoomFromDelta(delta: number): number {
  if (delta < 0.02) return 15;
  if (delta < 0.06) return 14;
  if (delta < 0.15) return 13;
  if (delta < 0.4) return 12;
  if (delta < 1.0) return 11;
  if (delta < 2.5) return 10;
  if (delta < 5) return 9;
  return 8;
}

function computeViewport(
  events: Event[],
  userLat: number | null,
  userLng: number | null,
): MapViewport {
  if (events.length === 0) {
    if (userLat != null && userLng != null) {
      return { centerLng: userLng, centerLat: userLat, zoom: 12 };
    }
    return NYC;
  }

  if (events.length === 1) {
    return {
      centerLng: events[0].locationLng!,
      centerLat: events[0].locationLat!,
      zoom: 14,
    };
  }

  const lats = events.map((e) => e.locationLat!);
  const lngs = events.map((e) => e.locationLng!);
  // Include user location in bounds so the user dot is always in frame
  if (userLat != null && userLng != null) {
    lats.push(userLat);
    lngs.push(userLng);
  }

  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const delta = Math.max(maxLat - minLat, maxLng - minLng);

  return {
    centerLat: (minLat + maxLat) / 2,
    centerLng: (minLng + maxLng) / 2,
    // Add 1 zoom level of padding so pins aren't clipped at edge
    zoom: Math.max(zoomFromDelta(delta) - 1, 6),
  };
}

// ── Controller ────────────────────────────────────────────────────────────────

const MAX_PINS = 25;
// Events beyond this radius are deprioritized unless there aren't enough nearby
const NEARBY_RADIUS_KM = 250;
// Max wait before showing map with whatever data is available
const SETTLE_TIMEOUT_MS = 900;

export interface EventMapControllerResult {
  viewport: MapViewport;
  isReady: boolean;
  markers: DvntMapMarker[];
  nearestCount: number;
  userLat: number | null;
  userLng: number | null;
}

export function useEventMapController(events: Event[]): EventMapControllerResult {
  const deviceLat = useEventsLocationStore((s) => s.deviceLat);
  const deviceLng = useEventsLocationStore((s) => s.deviceLng);
  const activeCity = useEventsLocationStore((s) => s.activeCity);
  const geocodedEventCoords = useEventsLocationStore((s) => s.geocodedEventCoords);
  const setGeocodedEventCoord = useEventsLocationStore((s) => s.setGeocodedEventCoord);

  const userLat = deviceLat ?? activeCity?.lat ?? null;
  const userLng = deviceLng ?? activeCity?.lng ?? null;

  // Merge geocoded coords into events that were missing lat/lng
  const enrichedEvents = useMemo(() => {
    return events.map((e) => {
      if (e.locationLat != null && e.locationLng != null) return e;
      const gc = geocodedEventCoords[e.id];
      if (gc) return { ...e, locationLat: gc.lat, locationLng: gc.lng };
      return e;
    });
  }, [events, geocodedEventCoords]);

  // Kick off geocoding for events missing coords.
  // Tracked with a ref — never in the effect deps — to prevent the geocoding
  // loop from re-triggering on each geocodedEventCoords state update.
  const geocodingSet = useRef(new Set<string>());
  useEffect(() => {
    for (const ev of enrichedEvents) {
      if (
        ev.locationLat == null &&
        !geocodingSet.current.has(ev.id) &&
        (ev.locationAddress || ev.locationName || ev.location)
      ) {
        geocodingSet.current.add(ev.id);
        const addr = ev.locationAddress || ev.locationName || ev.location || "";
        geocodeAddress(addr).then((coords) => {
          if (coords) setGeocodedEventCoord(ev.id, coords);
        });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enrichedEvents]);

  // Mappable events (have valid coordinates after enrichment)
  const mappableEvents = useMemo(
    () => enrichedEvents.filter((e) => e.locationLat != null && e.locationLng != null),
    [enrichedEvents],
  );

  // Nearest events to user, capped at MAX_PINS
  const nearestEvents = useMemo(() => {
    if (userLat == null || userLng == null) return mappableEvents.slice(0, MAX_PINS);

    const withDist = mappableEvents.map((e) => ({
      event: e,
      dist: distKm(userLat, userLng, e.locationLat!, e.locationLng!),
    }));
    withDist.sort((a, b) => a.dist - b.dist);

    // Prefer events within radius; fall back to all if not enough
    const nearby = withDist.filter((x) => x.dist <= NEARBY_RADIUS_KM);
    const pool = nearby.length >= 3 ? nearby : withDist;
    return pool.slice(0, MAX_PINS).map((x) => x.event);
  }, [mappableEvents, userLat, userLng]);

  // Viewport is settled ONCE. After settle, the camera never auto-updates again.
  // This is the core fix for double-load: we don't render the map until we have
  // a deterministic, final viewport, so the map mounts once at the right position.
  const settledRef = useRef(false);
  const [isReady, setIsReady] = useState(false);
  const [viewport, setViewport] = useState<MapViewport>(NYC);

  const settle = useCallback((vp: MapViewport) => {
    if (settledRef.current) return;
    settledRef.current = true;
    setViewport(vp);
    setIsReady(true);
  }, []);

  // Settle as soon as we have events OR user location
  useEffect(() => {
    if (settledRef.current) return;
    if (nearestEvents.length > 0 || userLat != null) {
      settle(computeViewport(nearestEvents, userLat, userLng));
    }
  }, [nearestEvents, userLat, userLng, settle]);

  // Hard timeout fallback — always show map within SETTLE_TIMEOUT_MS
  // Intentionally uses empty deps: fires once on mount only.
  useEffect(() => {
    const id = setTimeout(() => {
      if (!settledRef.current) {
        settle(computeViewport(nearestEvents, userLat, userLng));
      }
    }, SETTLE_TIMEOUT_MS);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Convert to stable markers — referentially stable as long as nearestEvents is stable
  const markers = useMemo<DvntMapMarker[]>(
    () =>
      nearestEvents.map((e) => ({
        id: e.id,
        coordinate: [e.locationLng!, e.locationLat!] as [number, number],
        title: e.title,
        subtitle:
          [e.date, e.location]
            .filter(Boolean)
            .join(" · ")
            .trim() || undefined,
        icon: "event" as const,
      })),
    [nearestEvents],
  );

  return {
    viewport,
    isReady,
    markers,
    nearestCount: nearestEvents.length,
    userLat,
    userLng,
  };
}
