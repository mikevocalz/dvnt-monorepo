/**
 * Native bridge to DVNTLiveActivity Swift module.
 * Wraps the ObjC-exported methods for Live Activity lifecycle management.
 */
import { NativeModules, Platform } from "react-native";

import type { LiveSurfacePayload } from "../types";

const { DVNTLiveActivity } = NativeModules;

const isIOS = Platform.OS === "ios";

/**
 * Check if Live Activities are enabled on this device.
 * Returns false on Android or if the native module is unavailable.
 */
export async function areLiveActivitiesEnabled(): Promise<boolean> {
  if (!isIOS || !DVNTLiveActivity) return false;
  try {
    return await DVNTLiveActivity.areLiveActivitiesEnabled();
  } catch {
    return false;
  }
}

/**
 * Start or update the DVNT Live Activity with the given payload.
 * The native module handles:
 * - Downloading the hero image to the app group container
 * - Building the ActivityKit ContentState
 * - Starting a new activity or updating the existing one
 * - Persisting the payload to UserDefaults for Home Widget access
 */
export function updateLiveActivity(payload: LiveSurfacePayload): void {
  if (!isIOS || !DVNTLiveActivity) return;
  try {
    DVNTLiveActivity.updateLiveActivity(JSON.stringify(payload));
  } catch (e) {
    console.warn("[LiveSurface] updateLiveActivity failed:", e);
  }
}

/**
 * End all active DVNT Live Activities.
 */
export function endLiveActivity(): void {
  if (!isIOS || !DVNTLiveActivity) return;
  try {
    DVNTLiveActivity.endLiveActivity();
  } catch (e) {
    console.warn("[LiveSurface] endLiveActivity failed:", e);
  }
}
