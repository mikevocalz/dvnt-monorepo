/**
 * React hook for managing the DVNT Live Surface.
 * Fetches the payload, pushes it to the native Live Activity bridge,
 * and exposes state for UI consumption.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";

import { fetchLiveSurface } from "../api";
import {
  areLiveActivitiesEnabled,
  endLiveActivity,
  updateLiveActivity,
} from "../native/ios-bridge";
import type { LiveSurfacePayload } from "../types";

interface UseLiveSurfaceOptions {
  /** Auto-fetch on mount and app foreground. Default: true */
  autoFetch?: boolean;
  /** Coordinates for weather. Omit to skip weather. */
  lat?: number;
  lng?: number;
  /** Refresh interval in ms. Default: 15 minutes */
  refreshInterval?: number;
}

interface UseLiveSurfaceReturn {
  payload: LiveSurfacePayload | null;
  isLoading: boolean;
  isLiveActivityEnabled: boolean;
  refresh: () => Promise<void>;
  end: () => void;
}

const FIFTEEN_MINUTES = 15 * 60 * 1000;

export function useLiveSurface(
  opts: UseLiveSurfaceOptions = {},
): UseLiveSurfaceReturn {
  const {
    autoFetch = true,
    lat,
    lng,
    refreshInterval = FIFTEEN_MINUTES,
  } = opts;

  const [payload, setPayload] = useState<LiveSurfacePayload | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isLiveActivityEnabled, setIsLiveActivityEnabled] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      const [data, enabled] = await Promise.all([
        fetchLiveSurface({ lat, lng }),
        areLiveActivitiesEnabled(),
      ]);
      setIsLiveActivityEnabled(enabled);
      if (data) {
        setPayload(data);
        updateLiveActivity(data);
      }
    } finally {
      setIsLoading(false);
    }
  }, [lat, lng]);

  const end = useCallback(() => {
    endLiveActivity();
  }, []);

  // Auto-fetch on mount
  useEffect(() => {
    if (!autoFetch) return;
    refresh();
  }, [autoFetch, refresh]);

  // Refresh on app foreground
  useEffect(() => {
    if (!autoFetch) return;
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") refresh();
    });
    return () => sub.remove();
  }, [autoFetch, refresh]);

  // Periodic refresh
  useEffect(() => {
    if (!autoFetch || refreshInterval <= 0) return;
    intervalRef.current = setInterval(refresh, refreshInterval);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [autoFetch, refresh, refreshInterval]);

  return { payload, isLoading, isLiveActivityEnabled, refresh, end };
}
