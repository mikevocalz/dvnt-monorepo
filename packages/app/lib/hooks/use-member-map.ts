import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Platform } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { memberMapApi, type LocationSettings } from "@dvnt/app/lib/api/member-map";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import { useEventsLocationStore } from "@dvnt/app/lib/stores/events-location-store";
import { useLocationAccessStore, locationAllowedFor, locationDurabilityError } from "@dvnt/app/lib/stores/location-access-store";
import { commitMapConsent, consentTimeout } from "@dvnt/app/lib/location/map-sharing-consent";
import { coarseMapPoint, mapGrantActive } from "@dvnt/app/lib/location/location-access";

let permissionProof: { owner: string; generation: number } | null = null;
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

/** Stops immediately even if a location provider is still awaiting a fix. */
function withdrawMapPermission(owner: string, client: ReturnType<typeof useQueryClient>) {
  const state = useLocationAccessStore.getState();
  if (currentOwner() !== owner || state.owner !== owner || state.pendingWithdrawal || !mapGrantActive(state.settings, Date.now())) return;
  permissionProof = null;
  state.stop("Location permission was revoked. Stopping avatar sharing…", true);
  clearLocalLocation();
  const generation = useLocationAccessStore.getState().generation;
  client.removeQueries({ queryKey: memberMapKeys.nearby(owner) });
  void serialize(async () => {
    if (currentOwner() !== owner) return;
    try {
      const stopped = await memberMapApi.revoke(owner, "events");
      if (currentOwner() === owner) {
        useLocationAccessStore.getState().accept(owner, stopped, true, generation);
        client.setQueryData(memberMapKeys.settings(owner), stopped);
      }
    } catch {
      if (currentOwner() === owner) useLocationAccessStore.getState().stop("Location permission is off. Could not confirm server withdrawal; retry Stop sharing.", true);
    }
  });
}

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
            ...(kind === "sharing" ? { consentVersion: "events-map-v1" as const, shareDurationHours: 4 as const } : {}),
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

/** Explicit UI disclosure is the only caller of share. OS permission alone is
 * never a map grant. Nothing is written until a fresh permitted sample exists. */
export function useMapSharingConsent(active: boolean) {
  const owner = useAuthStore((s) => s.user?.authId ?? null);
  const client = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lifetime = useRef(0);
  const pending = useRef<{ owner: string; revision: number; writing: boolean } | null>(null);
  const activeRef = useRef(active);
  activeRef.current = active;
  const invalidate = useCallback(() => {
    const request = pending.current;
    if (request?.writing) {
      const state = useLocationAccessStore.getState();
      if (state.owner === request.owner && currentOwner() === request.owner) {
        state.stop("Stopping sharing has not yet been confirmed by the server.", true);
        clearLocalLocation();
      } else useLocationAccessStore.setState(state => ({ pendingWithdrawals: { ...state.pendingWithdrawals, [request.owner]: { revision: request.revision } } }));
    }
    lifetime.current += 1; pending.current = null;
  }, []);
  useEffect(() => {
    lifetime.current += 1; pending.current = null; setBusy(false); setError(null);
    return invalidate;
  }, [owner, active, invalidate]);
  const cancel = useCallback(() => { invalidate(); setBusy(false); setError(null); }, [invalidate]);
  const share = useCallback(async (): Promise<boolean> => {
    if (pending.current || !isForeground() || !activeRef.current || !owner || currentOwner() !== owner) return false;
    const initial = useLocationAccessStore.getState();
    if (initial.owner !== owner || !initial.hydrationReady || !initial.settings || initial.pendingWithdrawal || locationDurabilityError() || (initial.blocked && initial.settings.locationEnabled)) {
      setError("Location privacy settings are not ready. Reload settings or retry stopping sharing first."); return false;
    }
    if (mapGrantActive(initial.settings, Date.now())) return false;
    const request = { owner, revision: initial.settings.revision, writing: false }; pending.current = request;
    const run = lifetime.current, generation = initial.generation;
    const sameOwner = () => currentOwner() === owner && useLocationAccessStore.getState().owner === owner;
    const current = () => activeRef.current && pending.current === request && lifetime.current === run && sameOwner() && useLocationAccessStore.getState().generation === generation && !useLocationAccessStore.getState().pendingWithdrawal;
    const allowed = () => current() && isForeground();
    setBusy(true); setError(null);
    try {
      const point = await consentTimeout((async () => {
        const point = await sampleLocation(current, true, false, () => {}, () => {});
        if (point && !await waitForConsentForeground(current)) return null;
        return point;
      })());
      if (!allowed()) return false;
      if (!point) throw new Error("Location access is off. Allow location in your browser or device settings, then try sharing again. You are not sharing.");
      permissionProof = { owner, generation };
      await serialize(() => commitMapConsent({
        allowed, sameOwner, point,
        settings: () => memberMapApi.settings(owner),
        enable: (revision) => { request.writing = true; return memberMapApi.updateSettings(owner, { expectedRevision: revision, locationEnabled: true, eventsMapEnabled: true, consentVersion: "events-map-v1", shareDurationHours: 4 }); },
        publish: (settings, coarse) => memberMapApi.publish(owner, { ...coarse, revision: settings.revision }),
        revoke: async (owned) => {
          const stopped = await memberMapApi.updateSettings(owner, { expectedRevision: owned.revision, locationEnabled: owned.locationEnabled, eventsMapEnabled: false });
          if (sameOwner()) { useLocationAccessStore.getState().accept(owner, stopped, true, useLocationAccessStore.getState().generation); client.setQueryData(memberMapKeys.settings(owner), stopped); }
        },
        committed: (result) => {
          // Commit local state synchronously with the transaction's final stale
          // check. Do not leave a cancellable network wait after publication.
          useLocationAccessStore.getState().accept(owner, result, true, generation);
          useLocationAccessStore.getState().activateAvatarSession(owner);
          client.setQueryData(memberMapKeys.settings(owner), result);
          pending.current = null; setBusy(false);
          void client.invalidateQueries({ queryKey: memberMapKeys.nearby(owner) });
        },
        withdrawalFailed: () => {
          if (sameOwner()) { useLocationAccessStore.getState().stop("Could not confirm server withdrawal. Retry Stop sharing.", true); clearLocalLocation(); }
          else useLocationAccessStore.setState(state => ({ pendingWithdrawals: { ...state.pendingWithdrawals, [owner]: { revision: initial.settings!.revision } } }));
        },
      }));
      return true;
    } catch (cause) {
      if (pending.current === request && sameOwner()) setError(cause instanceof Error ? cause.message : "Could not start sharing. Please try again.");
      return false;
    } finally { if (pending.current === request) { pending.current = null; setBusy(false); } }
  }, [owner, client]);
  return { share, cancel, busy, error };
}

function isForeground() { return Platform.OS === "web" ? (typeof document !== "undefined" && document.visibilityState === "visible") : AppState.currentState === "active"; }
/** Permission sheets can temporarily background native apps. Wait for the
 * same still-consenting lifetime to return before sampling or publishing. */
async function waitForConsentForeground(current: () => boolean): Promise<boolean> {
  const until = Date.now() + 15_000;
  while (current() && !isForeground() && Date.now() < until) await new Promise(resolve => setTimeout(resolve, 50));
  return current() && isForeground();
}
async function sampleLocation(allowed: () => boolean, requestPermission: boolean, previouslyGranted: boolean, onGranted: () => void, onDenied: () => void) {
  if (!allowed()) return null;
  if (Platform.OS === "web") {
    if (typeof navigator === "undefined" || !navigator.geolocation) throw new Error("Location isn't supported on this device.");
    // Permissions.query is advisory: Safari/WebViews may omit it or reject
    // geolocation even when getCurrentPosition is supported. The browser still
    // owns the permission decision. Never retry a prompt from the minute timer.
    let permission: PermissionState | null = null;
    try { permission = (await navigator.permissions?.query({ name: "geolocation" }))?.state ?? null; }
    catch { /* Unsupported permission query is not a location denial. */ }
    if (permission === "denied") { onDenied(); return null; }
    if (permission === "prompt" && !requestPermission) return null;
    if (permission === null && !requestPermission && !previouslyGranted) return null;
    if (!allowed()) return null;
    return new Promise<{ latitude: number; longitude: number; timestamp: number }>((resolve, reject) => navigator.geolocation.getCurrentPosition(
      (position) => { onGranted(); resolve({ latitude: position.coords.latitude, longitude: position.coords.longitude, timestamp: position.timestamp }); },
      (cause) => {
        if (cause?.code === 1) onDenied();
        else if (cause?.code === 2 || cause?.code === 3) onGranted();
        reject(new Error(cause?.code === 1 ? "Location access was denied. Allow location in your browser or device settings to center the map automatically." : "Location is temporarily unavailable. Please try again."));
      },
      { enableHighAccuracy: false, maximumAge: 0, timeout: 15_000 },
    ));
  }
  const Location = await import("expo-location");
  let permission = await Location.getForegroundPermissionsAsync();
  if (permission.status !== "granted" && permission.canAskAgain !== false && requestPermission && allowed()) {
    permission = await Location.requestForegroundPermissionsAsync();
  }
  if (permission.status !== "granted") { if (permission.status === "denied") onDenied(); return null; }
  onGranted();
  if (requestPermission && !await waitForConsentForeground(allowed)) return null;
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
  const permissionAttempted = useRef(false);
  const locationSucceeded = useRef(false);
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
    permissionAttempted.current = false;
    locationSucceeded.current = permissionProof?.owner === owner && permissionProof.generation === generation;
    setUpdating(false); setLocalArea(null); setError(null);
    const onVisibility = () => {
      lifecycle.current += 1;
      setLocalArea(null);
      if (isForeground()) void refreshRef.current();
    };
    const subscription = AppState.addEventListener("change", onVisibility);
    if (Platform.OS === "web" && typeof document !== "undefined") document.addEventListener("visibilitychange", onVisibility);
    let disposed = false;
    let permissionStatus: PermissionStatus | undefined;
    const onPermissionChange = () => { if (!disposed && owner && permissionStatus?.state === "denied") withdrawMapPermission(owner, client); };
    if (active && Platform.OS === "web" && typeof navigator !== "undefined") {
      void navigator.permissions?.query({ name: "geolocation" }).then(status => {
        if (disposed) return;
        permissionStatus = status;
        status.addEventListener?.("change", onPermissionChange);
      }).catch(() => {});
    }
    return () => {
      disposed = true; permissionStatus?.removeEventListener?.("change", onPermissionChange);
      activeRef.current = false; lifecycle.current += 1;
      queuedResume.current = false;
      subscription.remove();
      if (Platform.OS === "web" && typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [active, owner, generation, client]);
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
      // Passive map refresh never opens a permission sheet. The explicit sharing
      // disclosure (or a separate local-only location action) owns that request.
      const requestPermission = false;
      permissionAttempted.current = true;
      const withdrawDeniedPermission = () => {
        if (!allowed()) return;
        permissionProof = null;
        locationSucceeded.current = false; setLocalArea(null); clearLocalLocation();
        withdrawMapPermission(owner, client);
      };
      const point = await sampleLocation(allowed, requestPermission, locationSucceeded.current, () => {
        // Permission sheets may background the app. Remember only the OS grant,
        // never their obsolete coordinate, so foreground retry works on WebViews.
        if (activeRef.current && currentOwner() === owner && useLocationAccessStore.getState().generation === request.generation && inFlight.current === request) locationSucceeded.current = true;
      }, () => {
        if (inFlight.current === request) withdrawDeniedPermission();
      });
      if (!allowed()) return;
      if (!point) {
        locationSucceeded.current = false;
        setLocalArea(null);
        setError("Location access is off or unavailable. Allow location in your browser or device settings to center the map automatically.");
        return;
      }
      if (!Number.isFinite(point.timestamp) || Date.now() - point.timestamp > 60_000 || point.timestamp > Date.now() + 5_000) throw new Error("Your location is stale. The map will try again automatically.");
      locationSucceeded.current = true;
      const coarse = coarseMapPoint(point.latitude, point.longitude);
      setLocalArea({ ...coarse, owner, generation: request.generation, expiresAt: new Date(point.timestamp + 15 * 60_000).toISOString() });
      try { await serialize(async () => {
        const state = useLocationAccessStore.getState();
        if (!allowed() || !mapGrantActive(state.settings, Date.now())) return;
        await memberMapApi.publish(owner, { ...coarse, revision: state.settings!.revision, observedAt: new Date(point.timestamp).toISOString() });
        if (allowed()) await client.invalidateQueries({ queryKey: memberMapKeys.nearby(owner) });
      }); } catch (cause) {
        // Local centering and public avatar publication are separate. A failed
        // publish must not throw away a fresh permitted coarse location.
        if (allowed()) setError(cause instanceof Error ? `Your area is centered, but avatar sharing could not update: ${cause.message}` : "Your area is centered, but avatar sharing could not update. It will retry automatically.");
      }
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
