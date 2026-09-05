/**
 * Weather Refresh Hook
 *
 * Fetches weather from Open-Meteo when Events tab becomes visible,
 * then refreshes periodically. Supports event-time forecast override:
 * if an upcoming event has date + coords, its forecast overrides current.
 *
 * Uses TanStack Query for caching (15min staleTime) so re-entering
 * the tab doesn't re-fetch unnecessarily.
 */
import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useWeatherFXStore } from "../WeatherFXStore";
import {
  fetchCurrentWeather,
  fetchEventForecast,
  applyWeatherToStore,
} from "../WeatherDecisionEngine";
import { Debouncer } from "@tanstack/react-pacer";

const WEATHER_STALE_TIME = 15 * 60 * 1000; // 15 minutes

export interface UpcomingEventOverride {
  fullDate: string; // ISO 8601
  locationLat?: number;
  locationLng?: number;
}

/**
 * Call in the Events screen to keep weather data fresh.
 * Requires lat/lng from the events location store.
 * Optional upcomingEvent: when provided and in the future, uses event-time
 * forecast instead of current conditions (overrides for Events tab experience).
 */
export function useWeatherRefresh(
  lat: number | undefined,
  lng: number | undefined,
  upcomingEvent?: UpcomingEventOverride | null,
) {
  const weatherAmbianceEnabled = useWeatherFXStore(
    (s) => s.weatherAmbianceEnabled,
  );

  const eventLat = upcomingEvent?.locationLat ?? lat;
  const eventLng = upcomingEvent?.locationLng ?? lng;
  const useEventForecast =
    !!upcomingEvent?.fullDate &&
    eventLat != null &&
    eventLng != null &&
    new Date(upcomingEvent.fullDate) > new Date();

  const { data } = useQuery({
    queryKey: [
      "weatherFX",
      lat,
      lng,
      useEventForecast ? upcomingEvent!.fullDate : null,
      useEventForecast ? eventLat : null,
      useEventForecast ? eventLng : null,
    ],
    queryFn: async () => {
      if (useEventForecast && eventLat != null && eventLng != null) {
        const result = await fetchEventForecast(
          eventLat,
          eventLng,
          upcomingEvent!.fullDate,
        );
        return result;
      }
      if (lat != null && lng != null) {
        return fetchCurrentWeather(lat, lng);
      }
      return null;
    },
    enabled:
      ((lat != null && lng != null) || (eventLat != null && eventLng != null)) &&
      weatherAmbianceEnabled,
    staleTime: WEATHER_STALE_TIME,
    gcTime: 30 * 60 * 1000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });

  const applyDebouncer = useRef(
    new Debouncer(
      (code: number, metrics: any) => applyWeatherToStore(code, metrics),
      { wait: 200 },
    ),
  );

  useEffect(() => {
    if (data?.code != null && data?.metrics) {
      applyDebouncer.current.maybeExecute(data.code, data.metrics);
    }
  }, [data]);
}
