/**
 * Decides what "Use my current location" should do given the current
 * foreground location permission.
 *
 * iOS shows the system prompt once. After a denial, requesting again returns
 * "denied" without any UI, so the tap looked dead. Browsers behave the same
 * way, and expo-location's web implementation reports canAskAgain: true even
 * when the browser has blocked geolocation, so web denial is treated as final.
 */

export type LocationPermissionInput = {
  status: "granted" | "undetermined" | "denied" | string;
  canAskAgain: boolean;
  platform: "ios" | "android" | "web" | string;
};

export type LocationPermissionDecision =
  | { kind: "proceed" }
  | { kind: "request" }
  | { kind: "blocked"; canOpenSettings: boolean };

export function decideLocationPermission({
  status,
  canAskAgain,
  platform,
}: LocationPermissionInput): LocationPermissionDecision {
  if (status === "granted") return { kind: "proceed" };
  if (platform === "web") {
    return status === "denied"
      ? { kind: "blocked", canOpenSettings: false }
      : { kind: "request" };
  }
  if (canAskAgain) return { kind: "request" };
  return { kind: "blocked", canOpenSettings: true };
}
