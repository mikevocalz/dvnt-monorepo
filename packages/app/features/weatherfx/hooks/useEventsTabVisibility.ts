/**
 * Events Tab Visibility Hook
 *
 * Tracks whether the Events tab is currently focused.
 * Drives the WeatherGPUEngine visibility + audio fade.
 *
 * Uses Expo Router's usePathname — no useState.
 * Writes directly to WeatherFXStore.
 */
import { useEffect } from "react";
import { usePathname } from "expo-router";
import { useWeatherFXStore } from "../WeatherFXStore";

const EVENTS_PATHS = [
  "/events",
  "/ticket",
  "/(protected)/(tabs)/events",
  "/(protected)/events",
  "/(protected)/ticket",
  "(tabs)/events",
];

export function useEventsTabVisibility(): void {
  const pathname = usePathname();
  const setEventsTabVisible = useWeatherFXStore((s) => s.setEventsTabVisible);

  useEffect(() => {
    const isEvents = EVENTS_PATHS.some(
      (p) => pathname === p || pathname.startsWith(p + "/"),
    );
    setEventsTabVisible(isEvents);
  }, [pathname, setEventsTabVisible]);
}
