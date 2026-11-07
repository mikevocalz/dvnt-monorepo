import { useCallback, useEffect, useRef } from "react";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";

function ownerKey(user: unknown): string {
  const owner = user as { id?: string | number; authId?: string; auth_id?: string } | null;
  if (!owner?.id && !owner?.authId && !owner?.auth_id) return "";
  return [owner.id, owner.authId, owner.auth_id].map((value) => String(value ?? "")).join(":");
}

function currentOwnerKey(): string {
  const state = useAuthStore.getState();
  return state.isAuthenticated === false ? "" : ownerKey(state.user);
}

/** Synchronous account epochs catch even a batched A → B → A account switch. */
export function useLynkCreateScope(onOwnerChange: () => void) {
  const changeRef = useRef(onOwnerChange);
  changeRef.current = onOwnerChange;
  const scopeRef = useRef({ active: true, epoch: 0, owner: currentOwnerKey() });
  useEffect(() => {
    const scope = scopeRef.current;
    scope.active = true;
    const syncOwner = () => {
      const owner = currentOwnerKey();
      if (scope.owner === owner) return;
      scope.owner = owner;
      scope.epoch += 1;
      changeRef.current();
    };
    syncOwner();
    const unsubscribe = useAuthStore.subscribe(syncOwner);
    return () => {
      scope.active = false;
      scope.epoch += 1;
      unsubscribe();
    };
  }, []);
  const captureOwner = useCallback((expectedOwner: unknown) => {
    const epoch = scopeRef.current.epoch;
    const owner = ownerKey(expectedOwner);
    return () => Boolean(owner) && scopeRef.current.active &&
      scopeRef.current.epoch === epoch && scopeRef.current.owner === owner &&
      currentOwnerKey() === owner;
  }, []);
  const revoke = useCallback(() => {
    scopeRef.current.active = false;
    scopeRef.current.epoch += 1;
  }, []);
  const resume = useCallback(() => {
    // Focus starts a fresh lifetime; it cannot revive any pre-Back capture.
    if (!scopeRef.current.active) {
      scopeRef.current.epoch += 1;
      scopeRef.current.active = true;
    }
  }, []);
  return Object.assign(captureOwner, { revoke, resume });
}
