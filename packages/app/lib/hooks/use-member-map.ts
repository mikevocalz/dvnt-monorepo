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
  useEffect(() => {
    selectLocationOwner(owner);
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
    setBusy(true); setError(null);
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
        setError(message);
        if (!next) useLocationAccessStore.getState().stop("Could not confirm server withdrawal. Your device has stopped updating. Retry turning sharing off.", true);
      }
    } finally { setBusy(false); }
  }, [owner, client]);
  return { settings, enabled, sharing, avatarSessionActive: state.owner === owner && state.avatarSessionActive, busy, loading: !!owner && query.isPending,
    error: [(state.owner === owner ? state.error : null) || error || (query.isError ? "Location settings could not be loaded. No location will be used. Retry." : null), locationDurabilityError()].filter(Boolean).join(" ") || null,
    refresh: query.refetch,
    setOverall: (next: boolean) => update("overall", next), setSharing: (next: boolean) => update("sharing", next),
  };
}

function isForeground() { return Platform.OS === "web" ? (typeof document !== "undefined" && document.visibilityState === "visible") : AppState.currentState === "active"; }
async function sampleLocation(prompt: boolean, allowed: () => boolean) {
  if (!allowed()) return null;
  if (Platform.OS === "web") {
    if (typeof navigator === "undefined" || !navigator.geolocation) throw new Error("Location isn't supported on this device.");
    if (!prompt) {
      if (!navigator.permissions) return null;
      const permission = await navigator.permissions.query({ name: "geolocation" });
      if (permission.state !== "granted") return null;
    }
    if (!allowed()) return null;
    return new Promise<{ latitude: number; longitude: number; timestamp: number }>((resolve, reject) => navigator.geolocation.getCurrentPosition(
      (position) => resolve({ ...position.coords, latitude: position.coords.latitude, longitude: position.coords.longitude, timestamp: position.timestamp }),
      () => reject(new Error("Location access was denied or unavailable. Enable it in your browser/device settings, then retry.")),
      { enableHighAccuracy: false, maximumAge: 0, timeout: 15_000 },
    ));
  }
  const Location = await import("expo-location");
  let permission = await Location.getForegroundPermissionsAsync();
  if (permission.status !== "granted" && prompt && permission.canAskAgain) permission = await Location.requestForegroundPermissionsAsync();
  if (permission.status !== "granted") { if (!prompt) return null; throw new Error("Allow foreground location in device Settings, then retry."); }
  if (!allowed()) return null;
  const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
  return { latitude: position.coords.latitude, longitude: position.coords.longitude, timestamp: position.timestamp };
}

/** Mounted only by a visible, usable People map. No background tracking or automatic permission prompts. */
export function useMemberMapPresence(active: boolean) {
  const owner = useAuthStore((s) => s.user?.authId ?? null);
  const access = useLocationSettings();
  const client = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [isUpdating, setUpdating] = useState(false);
  const lifecycle = useRef(0);
  const activeRef = useRef(active);
  activeRef.current = active;
  useEffect(() => {
    activeRef.current = active;
    lifecycle.current += 1;
    const subscription = AppState.addEventListener("change", () => { lifecycle.current += 1; });
    const onVisibility = () => { lifecycle.current += 1; };
    if (Platform.OS === "web" && typeof document !== "undefined") document.addEventListener("visibilitychange", onVisibility);
    return () => {
      activeRef.current = false; lifecycle.current += 1; subscription.remove();
      if (Platform.OS === "web" && typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [active, owner]);
  const publish = useCallback(async (prompt: boolean) => {
    if (!active || !owner || !locationAllowedFor(owner) || !access.sharing || !isForeground()) return;
    if (prompt) useLocationAccessStore.getState().activateAvatarSession(owner);
    if (!useLocationAccessStore.getState().avatarSessionActive) return;
    const generation = useLocationAccessStore.getState().generation;
    const run = lifecycle.current;
    setUpdating(true); setError(null);
    try {
      const allowed = () => activeRef.current && lifecycle.current === run && currentOwner() === owner && useLocationAccessStore.getState().generation === generation && locationAllowedFor(owner) && mapGrantActive(useLocationAccessStore.getState().settings, Date.now()) && isForeground();
      // Recheck the account-backed grant before every collection, not just every poll.
      const fresh = await memberMapApi.settings(owner);
      if (!allowed()) return;
      useLocationAccessStore.getState().accept(owner, fresh);
      if (!mapGrantActive(fresh, Date.now())) { clearLocalLocation(); return; }
      const point = await sampleLocation(prompt, allowed);
      if (!point) { setError("Tap Update my location to allow location access and appear on the map."); return; }
      if (Date.now() - point.timestamp > 60_000) throw new Error("Your location is stale. Please try again.");
      await serialize(async () => {
        const state = useLocationAccessStore.getState();
        if (!activeRef.current || lifecycle.current !== run || currentOwner() !== owner || state.generation !== generation || !locationAllowedFor(owner) || !mapGrantActive(state.settings, Date.now()) || !isForeground()) return;
        await memberMapApi.publish(owner, { ...coarseMapPoint(point.latitude, point.longitude), revision: state.settings!.revision, observedAt: new Date(point.timestamp).toISOString() });
        if (currentOwner() === owner && useLocationAccessStore.getState().generation === generation) await client.invalidateQueries({ queryKey: memberMapKeys.nearby(owner) });
      });
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Location could not be updated."); }
    finally { setUpdating(false); }
  }, [active, owner, access.sharing, client]);
  useEffect(() => {
    if (!active || !access.sharing || !access.avatarSessionActive) return;
    void publish(false);
    const interval = setInterval(() => void publish(false), 60_000);
    return () => clearInterval(interval);
  }, [active, access.sharing, access.avatarSessionActive, publish]);
  return { error, isUpdating, refresh: () => publish(true) };
}

export function useNearbyMembers(active: boolean) {
  const owner = useAuthStore((s) => s.user?.authId ?? null);
  const access = useLocationSettings();
  const query = useQuery({ queryKey: memberMapKeys.nearby(owner || ""), enabled: active && !!owner && access.sharing,
    queryFn: () => memberMapApi.nearby(owner!), staleTime: 0, gcTime: 0, retry: 1, refetchInterval: 15_000, refetchOnWindowFocus: true });
  const valid = active && access.sharing && !query.isError && query.data?.expiresAt && Date.parse(query.data.expiresAt) > Date.now();
  return { ...query, data: valid ? { ...query.data!, members: query.data!.members.filter((member) => Date.parse(member.expiresAt) > Date.now()) } : undefined };
}
