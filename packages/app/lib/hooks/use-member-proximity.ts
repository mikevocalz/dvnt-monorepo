import { freshDeviceObservation } from "@dvnt/app/lib/location/device-observation";
import { useExactDistanceStore } from "@dvnt/app/lib/stores/exact-distance-store";
import { useLocationSettings } from "@dvnt/app/lib/hooks/use-member-map";
import { locationAllowedFor, useLocationAccessStore } from "@dvnt/app/lib/stores/location-access-store";
import { useEffect, useRef, useState } from "react";
import { serializeProximityWrite } from "@dvnt/app/lib/location/member-proximity-writes";
import { proximityStorageError, useMemberProximitySyncStore } from "@dvnt/app/lib/stores/member-proximity-sync-store";
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

type SyncScope = { authId: string | undefined; approved: boolean; loading: boolean };
const scopes = new Map<symbol, SyncScope>();
let syncEpoch = 0;
let lastPublished: string | null = null;
const scheduled = new Map<string, { promise: Promise<void>; intent: string; again: boolean }>();
const withdrawalError = "Could not confirm distance sharing has stopped. Your device has stopped updating. Retry Stop sharing distance.";

// Invalidate queued work even if an account switches away and back before React
// renders. No completed publication can be reused by a different sign-in.
useAuthStore.subscribe((next, previous) => {
  if (next.user?.authId !== previous.user?.authId || next.authStatus !== previous.authStatus) {
    syncEpoch += 1;
    lastPublished = null;
  }
});
useLocationAccessStore.subscribe((next, previous) => {
  if (next.owner !== previous.owner || next.settings?.sessionKey !== previous.settings?.sessionKey) {
    syncEpoch += 1;
    lastPublished = null;
  }
});

function syncPresence(authId: string): Promise<void> {
  const epoch = syncEpoch;
  // Coalesce duplicate effects from Settings/feed/StrictMode in this sign-in.
  // Read the latest intent when the shared queue actually reaches this job.
  const key = JSON.stringify([authId, epoch]);
  const live = useEventsLocationStore.getState();
  const accessNow = useLocationAccessStore.getState();
  const intent = JSON.stringify([live.cityVisibility, live.preciseProximityGrant, live.preciseProximityOwnerAuthId,
    live.deviceLat, live.deviceLng, live.deviceObservation, accessNow.blocked, accessNow.settings?.locationEnabled,
    useExactDistanceStore.getState().generation, [...scopes.values()].filter((value) => value.authId === authId)]);
  const existing = scheduled.get(key);
  if (existing) {
    if (existing.intent !== intent) { existing.intent = intent; existing.again = true; }
    return existing.promise;
  }
  const scheduledRequest = { promise: Promise.resolve(), intent, again: false };
  const operation = serializeProximityWrite(async () => {
    if (useAuthStore.getState().user?.authId !== authId || syncEpoch !== epoch) return;
    const scope = [...scopes.values()].find((value) => value.authId === authId && !value.loading);
    const state = useMemberProximitySyncStore.getState();
    // A stop is durable work; navigation must not cancel it. Positive sharing
    // only runs while a current, verified Settings/feed scope is mounted.
    if (!scope && !state.pendingWithdrawals[authId]) return;
    const location = useEventsLocationStore.getState();
    const liveGrant = readCityVisibility(location.cityVisibility, Date.now());
    const consentForThisAccount = readPreciseProximityGrant(location.preciseProximityGrant) &&
      location.preciseProximityOwnerAuthId === authId;
    const access = useLocationAccessStore.getState();
    const sessionKey = access.settings?.sessionKey;
    const mustWithdraw = state.pendingWithdrawals[authId] || !liveGrant || !consentForThisAccount ||
      (!!scope && !scope.approved) || (access.hydrationReady && access.owner === authId && !locationAllowedFor(authId));
    const status = (busy: boolean, error: string | null) => {
      if (useAuthStore.getState().user?.authId === authId && syncEpoch === epoch) {
        useMemberProximitySyncStore.setState({ status: { owner: authId, sessionKey, epoch, busy, error } });
      }
    };
    if (mustWithdraw) {
      const stoppedKey = JSON.stringify([authId, epoch, "stopped"]);
      if (!state.pendingWithdrawals[authId] && lastPublished === stoppedKey) return;
      state.beginWithdrawal(authId);
      status(true, null);
      try {
        await memberProximityApi.revoke(authId);
        useMemberProximitySyncStore.getState().confirmWithdrawal(authId);
        useExactDistanceStore.getState().confirmWithdrawal(authId);
        // The ordinary stop also revokes the exact server grant.
        if (useExactDistanceStore.getState().owner === authId) useExactDistanceStore.getState().clear();
        if (syncEpoch === epoch) lastPublished = stoppedKey;
        status(false, null);
      } catch {
        lastPublished = null;
        status(false, withdrawalError);
      }
      return;
    }
    if (!scope || !locationAllowedFor(authId)) return;
    if (!state.hydrationReady) {
      status(false, "Distance privacy preferences could not be read. Keep sharing off and retry after device storage is available.");
      return;
    }
    const lat = location.deviceLat;
    const lng = location.deviceLng;
    const validCoords = typeof lat === "number" && Number.isFinite(lat) && Math.abs(lat) <= 90 &&
      typeof lng === "number" && Number.isFinite(lng) && Math.abs(lng) <= 180;
    const observedAt = freshDeviceObservation(location.deviceObservation, authId, sessionKey);
    if (!validCoords || observedAt === null) {
      status(false, "Distance sharing needs a fresh device location. Refresh your location on the Events screen, then retry.");
      return;
    }
    const exact = useExactDistanceStore.getState();
    if (exact.pendingWithdrawals[authId]) return;
    const exactActive = exact.owner === authId && exact.sessionKey === sessionKey && Date.now() < exact.expiresAt;
    // Exact observations are single-use on the server. City/duration changes
    // must not replay an accepted exact fix or pretend to refresh its lease.
    const publicationKey = JSON.stringify([authId, epoch, sessionKey, observedAt, exactActive ? 2 : 1,
      ...(exactActive ? [] : [lat, lng, liveGrant!.cityId, liveGrant!.expiresAt])]);
    if (lastPublished === publicationKey) return;
    status(true, null);
    try {
      await memberProximityApi.publish({
        exactDistanceVersion: exactActive ? 2 : undefined,
        observedAt: new Date(observedAt).toISOString(),
        expectedAuthId: authId, expectedSessionId: sessionKey,
        latitude: lat, longitude: lng, cityId: liveGrant!.cityId,
        shareUntil: new Date(liveGrant!.expiresAt).toISOString(),
      });
      if (syncEpoch === epoch) lastPublished = publicationKey;
      status(false, null);
    } catch {
      // Never downgrade an exact publication to approximate distance on error.
      status(false, "Could not update distance sharing. Retry to confirm your setting, or stop sharing distance.");
    }
  }).finally(() => {
    scheduled.delete(key);
    if (scheduledRequest.again && syncEpoch === epoch) void syncPresence(authId);
  });
  scheduledRequest.promise = operation;
  scheduled.set(key, scheduledRequest);
  return operation;
}

/** Sync explicit Settings/feed intent through one account-scoped write queue. */
export function useSyncMemberProximityPresence() {
  const locationAccess = useLocationSettings();
  const authId = useAuthStore((s) => s.user?.authId);
  const location = useEventsLocationStore();
  const exactGeneration = useExactDistanceStore((s) => s.generation);
  const sync = useMemberProximitySyncStore();
  const { data: verification, isLoading } = useVerificationState();
  const token = useRef(Symbol("proximity scope"));
  const [, setClock] = useState(0);
  const sessionKey = locationAccess.settings?.sessionKey;
  const withdrawalPending = !!authId && sync.pendingWithdrawals[authId] === true;
  const current = sync.status && sync.status.owner === authId && sync.status.sessionKey === sessionKey && sync.status.epoch === syncEpoch ? sync.status : null;

  useEffect(() => {
    const id = token.current;
    scopes.set(id, { authId, approved: verification?.state === "approved", loading: isLoading });
    if (authId) void syncPresence(authId);
    return () => { scopes.delete(id); };
  }, [authId, verification?.state, isLoading, location.cityVisibility, location.preciseProximityGrant,
    location.preciseProximityOwnerAuthId, location.deviceLat, location.deviceLng, location.deviceObservation,
    sessionKey, locationAccess.enabled, exactGeneration, withdrawalPending]);

  // Expiry must withdraw even when Settings sits open without another render.
  const expiresAt = location.cityVisibility?.expiresAt;
  useEffect(() => {
    if (!authId || !expiresAt || expiresAt <= Date.now()) return;
    const timer = setTimeout(() => { setClock((value) => value + 1); void syncPresence(authId); }, expiresAt - Date.now() + 1);
    return () => clearTimeout(timer);
  }, [authId, expiresAt]);

  const stop = (city = false) => {
    if (!authId || useAuthStore.getState().user?.authId !== authId) return;
    useMemberProximitySyncStore.getState().beginWithdrawal(authId);
    useExactDistanceStore.getState().clear();
    try {
      if (city) useEventsLocationStore.getState().hideMeInCity();
      else useEventsLocationStore.getState().setPreciseProximityGrant(false, authId);
    } catch {
      // Zustand has already stopped locally. Durable negative intent still
      // blocks publication if the old location-store disk write failed.
    } finally {
      // Schedule before React can unmount this Settings screen. Changed intent
      // is drained after any old in-flight publish, including after navigation.
      void syncPresence(authId);
    }
  };
  return {
    busy: current?.busy ?? false,
    withdrawalPending,
    error: current?.error || (!sync.hydrationReady ? "Distance privacy preferences could not be read. Sharing remains off." : null) ||
      (!current?.busy && withdrawalPending ? withdrawalError : null) || proximityStorageError(),
    retry: () => authId ? syncPresence(authId) : Promise.resolve(),
    stop,
    setDistanceSharing: (next: boolean) => {
      if (!next) { stop(); return; }
      if (!authId || useAuthStore.getState().user?.authId !== authId ||
          useMemberProximitySyncStore.getState().pendingWithdrawals[authId] || !sync.hydrationReady) return;
      useEventsLocationStore.getState().setPreciseProximityGrant(true, authId);
    },
  };
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
