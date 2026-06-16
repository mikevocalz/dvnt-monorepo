import { useEffect, useRef } from "react";
import * as Location from "expo-location";
import { useEventsLocationStore } from "@/lib/stores/events-location-store";
import { useQueryClient } from "@tanstack/react-query";
import { cityKeys } from "@/lib/hooks/use-cities";
import { citiesApi } from "@/lib/api/cities";
import type { City } from "@/lib/stores/events-location-store";

/**
 * useBootLocation — runs ONCE on app boot inside ProtectedLayout.
 *
 * If location permission is already granted, silently fetches device coords,
 * updates deviceLat/deviceLng, and reverse-geocodes to set activeCity.
 * Always refreshes on boot so GPS-based filters ("Near Me") stay accurate.
 * Never prompts the user — only uses already-granted permission.
 */
export function useBootLocation() {
  const didRun = useRef(false);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (didRun.current) return;
    didRun.current = true;

    (async () => {
      try {
        let permission = await Location.getForegroundPermissionsAsync();

        if (
          permission.status !== "granted" &&
          permission.canAskAgain &&
          permission.status === "undetermined"
        ) {
          console.log("[BootLocation] Requesting location permission on boot");
          permission = await Location.requestForegroundPermissionsAsync();
        }

        if (permission.status !== "granted") {
          console.log("[BootLocation] No location permission available — skipping");
          return;
        }

        console.log("[BootLocation] Permission granted — fetching coords");
        const loc = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });

        const { latitude, longitude } = loc.coords;
        const { setDeviceLocation, setLocationMode, setActiveCity } =
          useEventsLocationStore.getState();
        setDeviceLocation(latitude, longitude);
        setLocationMode("device");

        // Get cities (from cache or fetch)
        let cities: City[] =
          queryClient.getQueryData<City[]>(cityKeys.list()) ?? [];
        if (cities.length === 0) {
          cities = await queryClient.fetchQuery({
            queryKey: cityKeys.list(),
            queryFn: () => citiesApi.getCities(),
            staleTime: 24 * 60 * 60 * 1000,
          });
        }

        // Try to find nearest DB city (within ~50km / ~0.5 deg)
        let nearest: City | null = null;
        let minDist = Infinity;
        for (const city of cities) {
          const dist = Math.sqrt(
            Math.pow(city.lat - latitude, 2) +
              Math.pow(city.lng - longitude, 2),
          );
          if (dist < minDist) {
            minDist = dist;
            nearest = city;
          }
        }

        // If a close DB city exists, use it
        if (nearest && minDist < 0.5) {
          console.log("[BootLocation] Nearest DB city:", nearest.name);
          setActiveCity(nearest);
          return;
        }

        // Reverse geocode to get actual city name from coords
        try {
          const [geo] = await Location.reverseGeocodeAsync({
            latitude,
            longitude,
          });
          if (geo?.city) {
            console.log("[BootLocation] Reverse geocoded city:", geo.city);
            // Check if a DB city matches the geocoded name
            const dbMatch = cities.find(
              (c) => c.name.toLowerCase() === geo.city!.toLowerCase(),
            );
            if (dbMatch) {
              setActiveCity(dbMatch);
            } else {
              // Create a synthetic city from geocode result
              setActiveCity({
                id: -1,
                name: geo.city,
                state: geo.region ?? null,
                country: geo.country ?? "US",
                lat: latitude,
                lng: longitude,
                timezone: null,
                slug: geo.city.toLowerCase().replace(/\s+/g, "-"),
              });
            }
            return;
          }
        } catch (geoErr) {
          console.warn("[BootLocation] Reverse geocode failed:", geoErr);
        }

        // Last resort: use nearest DB city regardless of distance
        if (nearest) {
          console.log(
            "[BootLocation] Fallback to nearest DB city:",
            nearest.name,
          );
          setActiveCity(nearest);
        }
      } catch (err) {
        console.warn("[BootLocation] Failed:", err);
      }
    })();
  }, [queryClient]);
}
