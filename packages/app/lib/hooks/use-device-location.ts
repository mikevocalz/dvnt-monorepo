/**
 * useDeviceLocation
 * Provides device GPS coords and a requestLocation() helper that asks for
 * foreground permission, fetches current position, and persists to the store.
 *
 * Used by the "In City" / "Near Me" filter so it works from live GPS instead
 * of a stale persisted city.
 */

import { useLocationSettings } from "@dvnt/app/lib/hooks/use-member-map";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import { locationAllowedFor, useLocationAccessStore } from "@dvnt/app/lib/stores/location-access-store";
import { useCallback } from "react";
import * as Location from "expo-location";
import { useEventsLocationStore } from "@dvnt/app/lib/stores/events-location-store";
import { useUIStore } from "@dvnt/app/lib/stores/ui-store";

export function useDeviceLocation() {
  const access = useLocationSettings();
  const deviceLat = useEventsLocationStore((s) => s.deviceLat);
  const deviceLng = useEventsLocationStore((s) => s.deviceLng);
  const setDeviceLocation = useEventsLocationStore((s) => s.setDeviceLocation);
  const setLocationMode = useEventsLocationStore((s) => s.setLocationMode);
  const showToast = useUIStore((s) => s.showToast);

  const isAvailable = access.enabled && deviceLat != null && deviceLng != null;

  /**
   * Requests foreground location permission (if not yet granted), fetches the
   * current position, and writes it to the store.
   * Returns true on success, false if permission was denied.
   */
  const requestLocation = useCallback(async (): Promise<boolean> => {
    const owner = useAuthStore.getState().user?.authId;
    const generation = useLocationAccessStore.getState().generation;
    if (!locationAllowedFor(owner)) { showToast("info", "Location is off", "Enable Use device location in Privacy settings first."); return false; }
    try {
      let permission = await Location.getForegroundPermissionsAsync();

      if (permission.status !== "granted") {
        if (!permission.canAskAgain) {
          showToast(
            "error",
            "Location Permission Required",
            "Enable location access in Settings to filter events near you.",
          );
          return false;
        }
        permission = await Location.requestForegroundPermissionsAsync();
      }

      if (permission.status !== "granted") {
        showToast(
          "info",
          "Location Needed",
          "Allow location access to use the 'Near Me' filter.",
        );
        return false;
      }

      if (useAuthStore.getState().user?.authId !== owner || !locationAllowedFor(owner) || useLocationAccessStore.getState().generation !== generation) return false;
      const loc = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      if (useAuthStore.getState().user?.authId !== owner || !locationAllowedFor(owner) || useLocationAccessStore.getState().generation !== generation) return false;
      setDeviceLocation(loc.coords.latitude, loc.coords.longitude);
      setLocationMode("device");
      return true;
    } catch (err) {
      console.warn("[useDeviceLocation] requestLocation failed:", err);
      showToast("error", "Location Error", "Could not get your location. Try again.");
      return false;
    }
  }, [setDeviceLocation, setLocationMode, showToast]);

  return { deviceLat: access.enabled ? deviceLat : null, deviceLng: access.enabled ? deviceLng : null, isAvailable, requestLocation };
}
