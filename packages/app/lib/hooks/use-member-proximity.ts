import { freshDeviceObservation } from "@dvnt/app/lib/location/device-observation";
import { useExactDistanceStore } from "@dvnt/app/lib/stores/exact-distance-store";
import { useLocationSettings } from "@dvnt/app/lib/hooks/use-member-map";
import { locationAllowedFor, useLocationAccessStore } from "@dvnt/app/lib/stores/location-access-store";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { type MemberProximityResult, memberProximityApi } from "@dvnt/app/lib/api/member-proximity";
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
  const observation = useEventsLocationStore((s) => s.deviceObservation);
  const { data: verification, isLoading } = useVerificationState();
  const exactGeneration = useExactDistanceStore(s => s.generation);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const lastPublished = useRef<string | null>(null);

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
        const exact = useExactDistanceStore.getState();
        const sessionKey = useLocationAccessStore.getState().settings?.sessionKey;
        const observedAt = freshDeviceObservation(location.deviceObservation, authId, sessionKey);
        // Do not revoke a valid consent merely because GPS is not ready, but
        // never refresh a presence lease from ancient/unknown cached coordinates.
        if (observedAt === null) return;
        const exactActive = exact.owner === authId && exact.sessionKey === sessionKey && Date.now() < exact.expiresAt;
        const publicationKey = JSON.stringify([authId, sessionKey, observedAt, exactActive ? 2 : 1]);
        if (lastPublished.current === publicationKey) return;
        await memberProximityApi.publish({
          exactDistanceVersion: exactActive ? 2 : undefined,
          observedAt: new Date(observedAt).toISOString(),
          expectedAuthId: authId, expectedSessionId: sessionKey,
          latitude: lat,
          longitude: lng,
          cityId: liveGrant.cityId,
          shareUntil: new Date(liveGrant.expiresAt).toISOString(),
        });
        lastPublished.current = publicationKey;
      } else {
        // Withdrawal remains available after verification expiry or ban.
        lastPublished.current = null;
        await memberProximityApi.revoke(authId);
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
    observation,
    locationAccess.settings?.sessionKey,
    verification?.state,
    isLoading,
    locationAccess.enabled,
    exactGeneration,
  ]);
}

/**
 * The viewer's position is no longer part of this read. The server uses the
 * caller's own presence row, so there is no device coordinate to send and
 * nothing position-shaped left to key the cache on.
 */
export function useMemberProximity(username: string | null | undefined) {
  const authId = useAuthStore((s) => s.user?.authId);

  const permitted = useLocationAccessStore(s => !!authId && s.owner === authId &&
    s.hydrationReady && !s.blocked && s.settings?.locationEnabled === true);
  const exact = useExactDistanceStore();
  const sessionKey = useLocationAccessStore(s => s.settings?.sessionKey);
  const ownUsername = useAuthStore(s => s.user?.username);
  const precise = useEventsLocationStore(s => s.preciseProximityGrant);
  const preciseOwner = useEventsLocationStore(s => s.preciseProximityOwnerAuthId);
  const cityVisibility = useEventsLocationStore(s => s.cityVisibility);
  const [, setClock] = useState(0);
  const now = Date.now();
  const cityGrant = readCityVisibility(cityVisibility, now);
  const enabled = permitted && readPreciseProximityGrant(precise) &&
    preciseOwner === authId && !!cityGrant && !!username && username !== ownUsername;
  const result = useQuery({
    queryKey: [...memberProximityKeys.byUsername(username || ""), authId, cityGrant?.expiresAt, exact.generation, sessionKey],
    enabled,
    // Feed cards share this cache per author. Do not start a polling loop for
    // every author in an infinite feed; the server also limits distance reads.
    staleTime: 60_000,
    retry: false,
    queryFn: () => memberProximityApi.distance({ targetUsername: username!, expectedAuthId: authId }),
  });
  // StaleTime does not expire displayed data. Hide it after at most one minute,
  // or immediately when the separate proximity consent/owner/grant is lost.
  // Do not create a per-author background polling loop for an infinite feed.
  const response: MemberProximityResult | undefined = result.data;
  const isExactResponse = (value: MemberProximityResult | undefined): value is
    Extract<MemberProximityResult, { consentVersion: 2 }> =>
    value?.kind === "distance" && "consentVersion" in value && value.consentVersion === 2;
  const exactResponse = isExactResponse(response) ? response : null;
  const exactAllowed = exact.owner === authId && exact.sessionKey === sessionKey && now < exact.expiresAt;
  const deadline = Math.min(cityGrant?.expiresAt ?? Infinity,
    exactResponse ? Math.min(exact.expiresAt, Date.parse(exactResponse.expiresAt)) : Infinity,
    result.dataUpdatedAt ? result.dataUpdatedAt + 60_000 : Infinity);
  useEffect(() => {
    if (!enabled || !Number.isFinite(deadline) || deadline <= Date.now()) return;
    const timer = setTimeout(() => setClock(value => value + 1), deadline - Date.now() + 1);
    return () => clearTimeout(timer);
  }, [enabled, deadline]);
  const fresh = result.dataUpdatedAt > 0 && result.dataUpdatedAt <= now && now < deadline;
  return { ...result, data: enabled && fresh && (!exactResponse || exactAllowed) && !result.isError ? result.data : undefined };
}
