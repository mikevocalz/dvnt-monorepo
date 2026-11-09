import * as Location from "expo-location";
import { useEventsLocationStore } from "../stores/events-location-store";
import { freshDeviceObservation } from "./device-observation";
import { consentTimeout } from "./map-sharing-consent";

/** Explicit consent action only. Never invent a timestamp for a cached fix. */
export async function sampleExactDistance(
  owner: string, sessionKey: string, allowed: () => boolean,
): Promise<void> {
  let live = true;
  const current = () => live && allowed();
  try { await consentTimeout((async () => {
    if (!current()) throw new Error("Sign-in changed");
    const permission = await Location.getForegroundPermissionsAsync();
    if (!current() || permission.status !== "granted") throw new Error("Allow device location first");
    const sample = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    const observation = { observedAt: sample.timestamp, ownerAuthId: owner, sessionKey };
    if (!current() || freshDeviceObservation(observation, owner, sessionKey) === null ||
        !Number.isFinite(sample.coords.latitude) || Math.abs(sample.coords.latitude) > 90 ||
        !Number.isFinite(sample.coords.longitude) || Math.abs(sample.coords.longitude) > 180) {
      throw new Error("A fresh location is required");
    }
    useEventsLocationStore.getState().setDeviceLocation(sample.coords.latitude, sample.coords.longitude, observation);
  })()); } finally { live = false; }
}
