import { useEffect } from "react";
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
 * `preciseProximityGrant`, which defaults off and has no consent surface yet,
 * so the publish branch is inert today and this hook revokes instead. That is
 * the honest reading of the city grant, which carries no coordinate.
 */
export function useSyncMemberProximityPresence() {
  const authId = useAuthStore((s) => s.user?.authId);
  const storedGrant = useEventsLocationStore((s) => s.cityVisibility);
  const storedPreciseGrant = useEventsLocationStore(
    (s) => s.preciseProximityGrant,
  );
  const latitude = useEventsLocationStore((s) => s.deviceLat);
  const longitude = useEventsLocationStore((s) => s.deviceLng);
  const { data: verification, isLoading } = useVerificationState();

  useEffect(() => {
    if (!authId || isLoading) return;

    const liveGrant = readCityVisibility(storedGrant, Date.now());
    const preciseGrant = readPreciseProximityGrant(storedPreciseGrant);
    const hasCoords =
      typeof latitude === "number" &&
      typeof longitude === "number" &&
      latitude !== 0 &&
      longitude !== 0;

    if (
      preciseGrant &&
      verification?.state === "approved" &&
      liveGrant &&
      hasCoords
    ) {
      void memberProximityApi
        .publish({
          latitude,
          longitude,
          cityId: liveGrant.cityId,
          shareUntil: new Date(liveGrant.expiresAt).toISOString(),
        })
        .catch((error) => {
          console.warn("[member-proximity] publish failed", error);
        });
      return;
    }

    // Revoke on explicit off/expiry, on a missing precise-location grant, and
    // whenever adult verification is not approved. This cannot expose a
    // coordinate; failure leaves the previous server row subject to its own
    // share_until deadline.
    void memberProximityApi.revoke().catch(() => {});
  }, [
    authId,
    storedGrant,
    storedPreciseGrant,
    latitude,
    longitude,
    verification?.state,
    isLoading,
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
