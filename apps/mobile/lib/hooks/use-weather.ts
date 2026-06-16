/**
 * React Query hook for NOAA 7-day weather forecast
 */

import { useQuery } from "@tanstack/react-query";
import { getWeatherForecast } from "@/lib/api/weather";
import { STALE_TIMES, GC_TIMES } from "@/lib/perf/stale-time-config";

export const weatherKeys = {
  forecast: (lat: number, lng: number) =>
    ["weather", "forecast", lat.toFixed(2), lng.toFixed(2)] as const,
};

export function useWeatherForecast(lat?: number, lng?: number) {
  return useQuery({
    queryKey: weatherKeys.forecast(lat ?? 0, lng ?? 0),
    queryFn: () => getWeatherForecast(lat!, lng!),
    enabled: lat != null && lng != null && lat !== 0 && lng !== 0,
    staleTime: STALE_TIMES.weather,
    gcTime: GC_TIMES.long,
    retry: 1,
  });
}
