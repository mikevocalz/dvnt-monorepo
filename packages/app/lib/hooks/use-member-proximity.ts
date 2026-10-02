import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { memberProximityApi } from "@dvnt/app/lib/api/member-proximity";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import { useEventsLocationStore } from "@dvnt/app/lib/stores/events-location-store";
import { useVerificationState } from "@dvnt/app/lib/hooks/use-age-verification";

export const memberProximityKeys = {
  byUsername: (username: string) => ["member-proximity", username] as const,
};

/**
 * Sync the existing explicit "show me in this city" grant to the server.
 *
 * The local setting remains the UX source of truth; the server record is only
 * the expiring private location snapshot used to compute distances. An
 * unverified/non-adult account is revoked rather than published.
 */
export function useSyncMemberProximityPresence() {
  const authId = useAuthStore((s) => s.user?.authId);
  const grant = useEventsLocationStore((s) => s.cityVisibility);
  const latitude = useEventsLocationStore((s) => s.deviceLat);
  const longitude = useEventsLocationStore((s) => s.deviceLng);
  const { data: verification, isLoading } = useVerificationState();

  useEffect(() => {
    if (!authId || isLoading) return;

    const liveGrant =
      grant && Number.isFinite(grant.expiresAt) && grant.expiresAt > Date.now()
        ? grant
        : null;
    const hasCoords =
      typeof latitude === "number" &&
      typeof longitude === "number" &&
      latitude !== 0 &&
      longitude !== 0;

    if (verification?.state === "approved" && liveGrant && hasCoords) {
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

    // Revoke on explicit off/expiry and whenever adult verification is not
    // approved. This cannot expose a coordinate; failure leaves the previous
    // server row subject to its own share_until deadline.
    void memberProximityApi.revoke().catch(() => {});
  }, [
    authId,
    grant?.cityId,
    grant?.expiresAt,
    latitude,
    longitude,
    verification?.state,
    isLoading,
  ]);
}

export function useMemberProximity(username: string | null | undefined) {
  const authId = useAuthStore((s) => s.user?.authId);
  const latitude = useEventsLocationStore((s) => s.deviceLat);
  const longitude = useEventsLocationStore((s) => s.deviceLng);

  return useQuery({
    queryKey: [
      ...memberProximityKeys.byUsername(username || ""),
      authId,
      latitude == null ? null : Math.round(latitude * 1000) / 1000,
      longitude == null ? null : Math.round(longitude * 1000) / 1000,
    ],
    enabled: !!authId && !!username,
    staleTime: 60_000,
    queryFn: () =>
      memberProximityApi.distance({
        targetUsername: username!,
        viewerLatitude: latitude,
        viewerLongitude: longitude,
      }),
  });
}
