import { useLocationSettings } from "@dvnt/app/lib/hooks/use-member-map";
import { locationAllowedFor } from "@dvnt/app/lib/stores/location-access-store";
import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { memberProximityApi } from "@dvnt/app/lib/api/member-proximity";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import { useEventsLocationStore } from "@dvnt/app/lib/stores/events-location-store";
import {
  readCityVisibility,
  readPreciseProximityGrant,
} from "@dvnt/app/lib/stores/city-discovery-visibility";
import { useVerificationState } from "@dvnt/app/lib/hooks/use-age-verification";

export const memberProximityKeys = {
  byUsername: (username: string) => ["member-proximity", username] as const,
};

/**
 * Sync the explicit "show me in this city" grant to the server.
 *
 * The local setting remains the UX source of truth; the server record is only
 * the expiring private location snapshot used to compute proximity bands. An
 * unverified/non-adult account is revoked rather than published.
 *
 * Two grants are needed to publish a coordinate, not one. `cityVisibility`
 * consents to a city name, and it is read through `readCityVisibility` so the
 * shape is validated instead of hand-checked. Device GPS additionally needs
 * `preciseProximityGrant`, which defaults off, is tied to the signed-in
 * account and can only be enabled through the separate privacy control.
 * A queued revocation cannot be overwritten by an older in-flight publish.
 */
export function useSyncMemberProximityPresence() {
  const locationAccess = useLocationSettings();
  const authId = useAuthStore((s) => s.user?.authId);
  const storedGrant = useEventsLocationStore((s) => s.cityVisibility);
  const storedPreciseGrant = useEventsLocationStore(
    (s) => s.preciseProximityGrant,
  );
  const grantOwner = useEventsLocationStore((s) => s.preciseProximityOwnerAuthId);
  const latitude = useEventsLocationStore((s) => s.deviceLat);
  const longitude = useEventsLocationStore((s) => s.deviceLng);
  const { data: verification, isLoading } = useVerificationState();
  const queue = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    if (!authId || isLoading) return;

    // Serialize these writes. An old location publish may be in flight when
    // someone hits "Stop sharing". Issuing revoke in parallel lets the older
    // publish complete last and silently restore the location record.
    queue.current = queue.current.catch(() => {}).then(async () => {
      // Account switches invalidate consent owned by another login. Every
      // request must be scoped to the current Better Auth principal.
      if (useAuthStore.getState().user?.authId !== authId) return;

      // Read the newest store snapshot at execution time, not the stale
      // captured state from when this action was queued.
      const location = useEventsLocationStore.getState();
      const liveGrant = readCityVisibility(location.cityVisibility, Date.now());
      const consentForThisAccount =
        readPreciseProximityGrant(location.preciseProximityGrant) &&
        location.preciseProximityOwnerAuthId === authId;
      const lat = location.deviceLat;
      const lng = location.deviceLng;
      const validCoords =
        typeof lat === "number" && Number.isFinite(lat) && Math.abs(lat) <= 90 &&
        typeof lng === "number" && Number.isFinite(lng) && Math.abs(lng) <= 180;

      if (locationAllowedFor(authId) && consentForThisAccount && liveGrant && validCoords &&
          verification?.state === "approved") {
        await memberProximityApi.publish({
          latitude: lat,
          longitude: lng,
          cityId: liveGrant.cityId,
          shareUntil: new Date(liveGrant.expiresAt).toISOString(),
        });
      } else {
        // Withdrawal remains available after verification expiry or ban.
        await memberProximityApi.revoke();
      }
    }).catch((error) => {
      console.warn("[member-proximity] sync failed", error);
    });
  }, [
    authId,
    storedGrant,
    storedPreciseGrant,
    grantOwner,
    latitude,
    longitude,
    verification?.state,
    isLoading,
    locationAccess.enabled,
  ]);
}

/**
 * The viewer's position is no longer part of this read. The server uses the
 * caller's own presence row, so there is no device coordinate to send and
 * nothing position-shaped left to key the cache on.
 */
export function useMemberProximity(username: string | null | undefined) {
  const authId = useAuthStore((s) => s.user?.authId);

  return useQuery({
    queryKey: [...memberProximityKeys.byUsername(username || ""), authId],
    enabled: !!authId && !!username,
    staleTime: 60_000,
    queryFn: () => memberProximityApi.distance({ targetUsername: username! }),
  });
}
