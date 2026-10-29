import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Platform } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { memberMapApi, type LocationSettings } from "@dvnt/app/lib/api/member-map";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import { useEventsLocationStore } from "@dvnt/app/lib/stores/events-location-store";
import { useLocationAccessStore, locationAllowedFor, locationDurabilityError } from "@dvnt/app/lib/stores/location-access-store";
import { coarseMapPoint, mapGrantActive } from "@dvnt/app/lib/location/location-access";

let writes: Promise<unknown> = Promise.resolve();
const serialize = <T,>(fn: () => Promise<T>): Promise<T> => {
  const result = writes.catch(() => {}).then(fn); writes = result; return result;
};
export const memberMapKeys = { settings: (owner: string) => ["member-map-settings", owner] as const, nearby: (owner: string) => ["member-map-nearby", owner] as const };
function clearLocalLocation() {
  useEventsLocationStore.setState({ deviceLat: null, deviceLng: null, locationMode: "city", preciseProximityGrant: false, preciseProximityOwnerAuthId: null, cityVisibility: null });
  const city = useEventsLocationStore.getState().activeCity;
  if (city && city.id < 0) useEventsLocationStore.setState({ activeCity: null });
}
function selectLocationOwner(owner: string | null) {
  if (useLocationAccessStore.getState().owner !== owner) clearLocalLocation();
  useLocationAccessStore.getState().selectOwner(owner);
}
function currentOwner() { return useAuthStore.getState().user?.authId ?? null; }

export function useLocationSettings() {
  const owner = useAuthStore((s) => s.user?.authId ?? null);
  const state = useLocationAccessStore();
  const client = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  const [error, setError] = useState<string | null>(null);
  const [failedEnable, setFailedEnable] = useState<"overall" | "sharing" | null>(null);
  const errorGeneration = useRef(0);
  useEffect(() => {
    selectLocationOwner(owner);
    errorGeneration.current += 1;
    setError(null); setFailedEnable(null);
  }, [owner]);
  const query = useQuery({
    queryKey: memberMapKeys.settings(owner || ""), enabled: !!owner,
    staleTime: 0, retry: 1, refetchInterval: 30_000, refetchOnWindowFocus: true,
    queryFn: async () => {
      if (currentOwner() !== owner) throw new Error("Account changed.");
      selectLocationOwner(owner);
      const before = useLocationAccessStore.getState();
      const generation = before.generation;
      const data = await memberMapApi.settings(owner!);
      const latest = useLocationAccessStore.getState();
      if (currentOwner() === owner && latest.generation === generation) {
        // A failed withdrawal is sticky until a successful retry, not undone by polling.
        latest.accept(owner!, data, true);
        if (!data.locationEnabled) clearLocalLocation();
      }
      return data;
    },
  });
  useEffect(() => { if (query.isError && useLocationAccessStore.getState().owner === owner) { useLocationAccessStore.getState().stop(); clearLocalLocation(); } }, [query.isError, owner]);
  const settings = state.owner === owner ? state.settings : null;
  const enabled = state.owner === owner && !state.blocked && settings?.locationEnabled === true && !query.isError;
  const sharing = enabled && mapGrantActive(settings, now);
  const update = useCallback(async (kind: "overall" | "sharing", next: boolean) => {
    if (!owner || currentOwner() !== owner) return;
    errorGeneration.current += 1;
    setBusy(true); setError(null); setFailedEnable(null);
    let mutationGeneration = useLocationAccessStore.getState().generation;
    if (!next) {
      useLocationAccessStore.getState().stop("Stopping sharing has not yet been confirmed by the server.", true);
      mutationGeneration = useLocationAccessStore.getState().generation;
      clearLocalLocation();
      await client.cancelQueries({ queryKey: ["member-map-nearby"] });
      client.removeQueries({ queryKey: ["member-map-nearby"] });
    }
    try {
      await serialize(async () => {
        if (currentOwner() !== owner) throw new Error("Account changed. Please reopen Settings.");
        let result: LocationSettings;
        // Withdrawal never depends on a settings read, revision or publish rate limit.
        if (!next) result = await memberMapApi.revoke(owner, kind === "overall" ? "overall" : "events");
        else {
          const fresh = await memberMapApi.settings(owner!);
          if (currentOwner() !== owner) throw new Error("Account changed.");
          result = await memberMapApi.updateSettings(owner, {
            expectedRevision: fresh.revision,
            locationEnabled: kind === "overall" ? true : fresh.locationEnabled,
            eventsMapEnabled: kind === "sharing",
            ...(kind === "sharing" ? { consentVersion: "events-map-v1" as const } : {}),
          });
        }
        if (currentOwner() !== owner) return;
        useLocationAccessStore.getState().accept(owner, result, true, mutationGeneration);
        if (next && kind === "sharing" && useLocationAccessStore.getState().generation === mutationGeneration) useLocationAccessStore.getState().activateAvatarSession(owner);
        client.setQueryData(memberMapKeys.settings(owner), result);
        await client.invalidateQueries({ queryKey: memberMapKeys.nearby(owner) });
      });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Location settings could not be saved. Retry.";
      if (currentOwner() === owner) {
        errorGeneration.current += 1;
        setError(message);
        setFailedEnable(next ? kind : null);
        if (!next) useLocationAccessStore.getState().stop("Could not confirm server withdrawal. Your device has stopped updating. Use Turn all location off to retry.", true);
      }
    } finally { setBusy(false); }
  }, [owner, client]);
  const refresh = async () => {
    const generation = errorGeneration.current;
    const result = await query.refetch();
    if (!result.isError && currentOwner() === owner && generation === errorGeneration.current) {
      setError(null); setFailedEnable(null);
    }
    return result;
  };
  return { needsLocationStop: state.owner === owner && (state.pendingWithdrawal || (state.blocked && settings?.locationEnabled === true)), failedEnable, settings, enabled, sharing, avatarSessionActive: state.owner === owner && state.avatarSessionActive, busy, loading: !!owner && query.isPending,
    error: [(state.owner === owner ? state.error : null) || error || (query.isError ? "Location settings could not be loaded. No location will be used. Retry." : null), locationDurabilityError()].filter(Boolean).join(" ") || null,
    refresh,
    setOverall: (next: boolean) => update("overall", next), setSharing: (next: boolean) => update("sharing", next),
  };
}

function isForeground() { return Platform.OS === "web" ? (typeof document !== "undefined" && document.visibilityState === "visible") : AppState.currentState === "active"; }
async function sampleLocation(allowed: () => boolean) {
  if (!allowed()) return null;
  if (Platform.OS === "web") {
    if (typeof navigator === "undefined" || !navigator.geolocation) throw new Error("Location isn't supported on this device.");
    if (!navigator.permissions) return null;
    const permission = await navigator.permissions.query({ name: "geolocation" });
    if (permission.state !== "granted") return null;
    if (!allowed()) return null;
    return new Promise<{ latitude: number; longitude: number; timestamp: number }>((resolve, reject) => navigator.geolocation.getCurrentPosition(
      (position) => resolve({ ...position.coords, latitude: position.coords.latitude, longitude: position.coords.longitude, timestamp: position.timestamp }),
      () => reject(new Error("Location access was denied or unavailable. Allow location in your browser or device settings; the map will retry automatically.")),
      { enableHighAccuracy: false, maximumAge: 0, timeout: 15_000 },
    ));
  }
  const Location = await import("expo-location");
  const permission = await Location.getForegroundPermissionsAsync();
  if (permission.status !== "granted") return null;
  if (!allowed()) return null;
  const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
  return { latitude: position.coords.latitude, longitude: position.coords.longitude, timestamp: position.timestamp };
}

/** Visible-map foreground updates only. OS permission and avatar consent remain separate. */
export function useMemberMapPresence(active: boolean) {
  const owner = useAuthStore((s) => s.user?.authId ?? null);
  const access = useLocationSettings();
  const generation = useLocationAccessStore((s) => s.generation);
  const client = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [isUpdating, setUpdating] = useState(false);
  const [now, setNow] = useState(Date.now);
  const [localArea, setLocalArea] = useState<{
    owner: string; generation: number; latitude: number; longitude: number; expiresAt: string;
  } | null>(null);
  const lifecycle = useRef(0);
  const activeRef = useRef(active);
  const inFlight = useRef<{ run: number; owner: string; generation: number } | null>(null);
  const queuedResume = useRef(false);
  const refreshRef = useRef<() => Promise<void>>(async () => {});
  activeRef.current = active;
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  useEffect(() => { setLocalArea((area) => area && Date.parse(area.expiresAt) <= now ? null : area); }, [now]);
  useEffect(() => {
    activeRef.current = active;
    lifecycle.current += 1;
    // Detach obsolete ownership/consent/map lifetimes. Their callbacks cannot
    // publish or clear a newer request's busy state (identity-checked finally).
    inFlight.current = null; queuedResume.current = false;
    setUpdating(false); setLocalArea(null); setError(null);
    const onVisibility = () => {
      lifecycle.current += 1;
      setLocalArea(null);
      if (isForeground()) void refreshRef.current();
    };
    const subscription = AppState.addEventListener("change", onVisibility);
    if (Platform.OS === "web" && typeof document !== "undefined") document.addEventListener("visibilitychange", onVisibility);
    return () => {
      activeRef.current = false; lifecycle.current += 1;
      queuedResume.current = false;
      subscription.remove();
      if (Platform.OS === "web" && typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [active, owner, generation]);
  const refresh = useCallback(async () => {
    if (!active || !owner || !access.enabled || !locationAllowedFor(owner) || !isForeground()) return;
    const currentGeneration = useLocationAccessStore.getState().generation;
    if (inFlight.current) {
      if (inFlight.current.owner === owner && inFlight.current.generation === currentGeneration) {
        if (inFlight.current.run !== lifecycle.current) queuedResume.current = true;
        return;
      }
      inFlight.current = null; queuedResume.current = false;
    }
    const request = { run: lifecycle.current, owner, generation: currentGeneration };
    inFlight.current = request;
    setUpdating(true); setError(null);
    const allowed = () => activeRef.current && lifecycle.current === request.run && currentOwner() === owner && useLocationAccessStore.getState().generation === request.generation && locationAllowedFor(owner) && isForeground();
    try {
      // Recheck overall permission before every collection. A server-side avatar
      // opt-out does not forbid local centering, but it always forbids publishing.
      const fresh = await memberMapApi.settings(owner);
      if (!allowed()) return;
      useLocationAccessStore.getState().accept(owner, fresh);
      if (!allowed()) { setLocalArea(null); clearLocalLocation(); return; }
      const point = await sampleLocation(allowed);
      if (!allowed()) return;
      if (!point) {
        setLocalArea(null);
        setError("Location access is off or unavailable. Allow location in your browser or device settings to center the map automatically.");
        return;
      }
      if (!Number.isFinite(point.timestamp) || Date.now() - point.timestamp > 60_000 || point.timestamp > Date.now() + 5_000) throw new Error("Your location is stale. The map will try again automatically.");
      const coarse = coarseMapPoint(point.latitude, point.longitude);
      setLocalArea({ ...coarse, owner, generation: request.generation, expiresAt: new Date(point.timestamp + 15 * 60_000).toISOString() });
      await serialize(async () => {
        const state = useLocationAccessStore.getState();
        if (!allowed() || !mapGrantActive(state.settings, Date.now())) return;
        await memberMapApi.publish(owner, { ...coarse, revision: state.settings!.revision, observedAt: new Date(point.timestamp).toISOString() });
        if (allowed()) await client.invalidateQueries({ queryKey: memberMapKeys.nearby(owner) });
      });
    } catch (cause) {
      if (allowed()) {
        setLocalArea(null);
        setError(cause instanceof Error ? cause.message : "Location could not be updated. The map will try again automatically.");
      }
    } finally {
      if (inFlight.current === request) {
        inFlight.current = null;
        setUpdating(false);
        const retry = queuedResume.current;
        queuedResume.current = false;
        if (retry && activeRef.current && currentOwner() === owner && useLocationAccessStore.getState().generation === request.generation && isForeground()) void refreshRef.current();
      }
    }
  }, [active, owner, access.enabled, client]);
  refreshRef.current = refresh;
  useEffect(() => {
    if (!active || !access.enabled) { setLocalArea(null); return; }
    void refresh();
    const interval = setInterval(() => void refresh(), 60_000);
    return () => clearInterval(interval);
  }, [active, owner, generation, access.enabled, access.sharing, refresh]);
  const area = active && access.enabled && localArea?.owner === owner && localArea.generation === generation && Date.parse(localArea.expiresAt) > now
    ? { latitude: localArea.latitude, longitude: localArea.longitude, expiresAt: localArea.expiresAt } : null;
  return { error, isUpdating, area, refresh };
}

export function useNearbyMembers(active: boolean) {
  const owner = useAuthStore((s) => s.user?.authId ?? null);
  const access = useLocationSettings();
  const query = useQuery({ queryKey: memberMapKeys.nearby(owner || ""), enabled: active && !!owner && access.sharing,
    queryFn: () => memberMapApi.nearby(owner!), staleTime: 0, gcTime: 0, retry: 1, refetchInterval: 15_000, refetchOnWindowFocus: true });
  const valid = active && access.sharing && !query.isError && query.data?.expiresAt && Date.parse(query.data.expiresAt) > Date.now();
  return { ...query, data: valid ? { ...query.data!, members: query.data!.members.filter((member) => Date.parse(member.expiresAt) > Date.now()) } : undefined };
}
