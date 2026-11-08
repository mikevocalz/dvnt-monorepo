import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { AppState } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import { getCurrentUserRow } from "@dvnt/app/lib/auth/identity";
import { getSessionLifecycle, subscribeSessionLifecycle } from "@dvnt/app/lib/auth/session-lifecycle";
import type { SneakyRoom } from "../types";
import { sneakyLynkApi } from "../api/supabase";
import { discoveryMonotonicNow } from "../discovery-room-state";
import { selectDiscoveryRooms } from "../discovery-rooms";
import { useLynkHistoryStore } from "../stores/lynk-history-store";

// Subscribe synchronously, including batched logout/A → B → A transitions and
// same-account session replacement. A profile update can lag the actual session.
let scopeEpoch = 0;
let previousIdentity = "";
let snapshot = { key: "", accountKey: "", selfIds: [] as string[], allowed: false, signedIn: false, needsIdentity: false, profileId: "" };
function syncScope() {
  const auth = useAuthStore.getState();
  const user = auth.user as { id?: string | number; authId?: string; auth_id?: string; email?: string } | null;
  const session = getSessionLifecycle();
  const canonical = String(user?.authId || user?.auth_id || (user?.id && !/^\d+$/.test(String(user.id)) ? user.id : ""));
  const identity = JSON.stringify([auth.isAuthenticated, user?.id, user?.authId, user?.auth_id, user?.email?.toLowerCase(), session.epoch, session.ready, session.authId]);
  if (identity !== previousIdentity) {
    previousIdentity = identity;
    scopeEpoch += 1;
    snapshot = {
      key: `${canonical}:${session.epoch}:${scopeEpoch}`,
      accountKey: canonical,
      selfIds: [user?.id, user?.authId, user?.auth_id].filter((id) => id != null).map(String),
      signedIn: auth.isAuthenticated !== false && !!user,
      profileId: String(user?.id ?? ""),
      needsIdentity: auth.isAuthenticated !== false && !!user?.id && !canonical && session.ready,
      allowed: auth.isAuthenticated !== false && !!canonical && session.ready &&
        (!session.authId || session.authId === canonical),
    };
  }
  return snapshot;
}
const scopeListeners = new Set<() => void>();
function notifyScope() { syncScope(); for (const listener of scopeListeners) listener(); }
useAuthStore.subscribe(notifyScope);
subscribeSessionLifecycle(notifyScope);
const subscribeScope = (listener: () => void) => { scopeListeners.add(listener); return () => { scopeListeners.delete(listener); }; };

/** Discovery has bounded proof leases, not persistent admission permissions. */
export function useLynkDiscovery(enabled = true) {
  const scope = useSyncExternalStore(subscribeScope, syncScope, syncScope);
  const localRooms = useLynkHistoryStore((state) => state.rooms);
  const lifetime = useRef({ active: true });
  const requestGeneration = useRef(0);
  // Old query cache/persistence/remounts cannot resurrect a captured auth closure.
  const accepted = useRef<{ rooms: SneakyRoom[]; key: string } | null>(null);
  useEffect(() => {
    lifetime.current.active = true;
    return () => { lifetime.current.active = false; requestGeneration.current++; accepted.current = null; };
  }, []);
  const scopeIsCurrent = () => lifetime.current.active && syncScope().key === scope.key;
  const isCurrent = () => scopeIsCurrent() && scope.allowed && syncScope().allowed;
  // Existing persisted sessions can have only the integer profile ID. Resolve its
  // auth identity before discovery, without borrowing the new session's identity.
  const identity = useQuery({
    queryKey: ["sneaky-lynk", "discovery-identity", scope.key],
    enabled: enabled && scope.needsIdentity,
    retry: 1,
    queryFn: async ({ signal }) => {
      const current = () => scopeIsCurrent() && scope.needsIdentity && !signal.aborted;
      if (!current()) throw new Error("Discovery account changed");
      const row = await getCurrentUserRow(true);
      if (!current()) throw new Error("Discovery account changed");
      const session = getSessionLifecycle();
      if (!row?.authId || String(row.id) !== scope.profileId ||
        (session.authId && session.authId !== row.authId)) throw new Error("Could not verify the discovery account");
      useAuthStore.getState().updateUser({ authId: row.authId });
      return row.authId;
    },
  });
  const query = useQuery({
    queryKey: ["sneaky-lynk", "rooms", scope.accountKey, scope.key],
    queryFn: async ({ signal }) => {
      if (!enabled || !isCurrent()) throw new Error("Discovery account changed");
      const generation = ++requestGeneration.current;
      const requestIsCurrent = () => isCurrent() && !signal.aborted && requestGeneration.current === generation;
      const rooms = await sneakyLynkApi.getLiveRooms({ isCurrent: requestIsCurrent });
      if (!requestIsCurrent()) throw new Error("Discovery request replaced");
      accepted.current = { rooms, key: scope.key };
      return rooms;
    },
    enabled: enabled && scope.allowed,
    structuralSharing: false,
    refetchOnMount: "always",
    staleTime: 10_000,
    refetchInterval: enabled && scope.allowed ? 20_000 : false,
    retry: 1,
  });
  const clock = useMemo(() => {
    let value = 0;
    const listeners = new Set<() => void>();
    return { get: () => value, subscribe: (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; },
      tick: () => { value++; for (const fn of listeners) fn(); } };
  }, []);
  const clockVersion = useSyncExternalStore(clock.subscribe, clock.get, clock.get);
  useEffect(() => {
    if (!enabled || !scope.allowed) return;
    const now = Date.now(), monotonic = discoveryMonotonicNow();
    let delay = 1000;
    for (const room of query.data ?? []) {
      const elapsed = Math.max(0, now - (room.requestStartedAt ?? NaN), monotonic - (room.requestStartedMonotonic ?? NaN));
      const observed = Date.parse(room.observedAt ?? "");
      for (const lease of [90_000, Date.parse(room.presenceExpiresAt ?? "") - observed, Date.parse(room.endsAt ?? "") - observed]) {
        const remaining = lease - elapsed;
        if (Number.isFinite(remaining) && remaining > 0) delay = Math.min(delay, remaining);
      }
    }
    const timer = setTimeout(clock.tick, Math.max(1, delay));
    return () => clearTimeout(timer);
  }, [clock, clockVersion, enabled, scope.allowed, query.data]);
  useEffect(() => {
    const wake = () => clock.tick();
    const native = AppState?.addEventListener?.("change", wake);
    if (typeof window !== "undefined") {
      window.addEventListener("focus", wake);
      window.addEventListener("pageshow", wake);
      document.addEventListener("visibilitychange", wake);
    }
    return () => {
      native?.remove();
      if (typeof window !== "undefined") {
        window.removeEventListener("focus", wake);
        window.removeEventListener("pageshow", wake);
        document.removeEventListener("visibilitychange", wake);
      }
    };
  }, [clock]);
  const remote = query.data && accepted.current?.rooms === query.data && accepted.current.key === scope.key ? query.data : [];
  const rooms = scope.allowed ? selectDiscoveryRooms(remote, localRooms, scope.selfIds, () => isCurrent() && (remote.length === 0 || (accepted.current?.rooms === remote && accepted.current.key === scope.key))) : [];
  const identityPending = enabled && scope.signedIn && !scope.allowed;
  return { rooms,
    isLoading: identityPending ? !identity.isError : enabled && scope.allowed && query.isLoading,
    isFetching: enabled && (scope.needsIdentity ? identity.isFetching : scope.allowed && query.isFetching),
    isError: scope.needsIdentity ? identity.isError : scope.allowed && query.isError,
    refetch: () => !enabled || !scopeIsCurrent() ? Promise.resolve(undefined) :
      scope.needsIdentity ? identity.refetch() : isCurrent() ? query.refetch() : Promise.resolve(undefined) };
}
