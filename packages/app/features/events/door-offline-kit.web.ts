"use client";

/**
 * Keeping a door working when the venue's signal does not.
 *
 * Two jobs, neither of which may ever block a scan:
 *   • pull the valid-token list down while there IS signal, so an offline
 *     scanner can still tell a real ticket from a stranger's screenshot
 *   • push queued offline check-ins back up once signal returns
 *
 * The second job is why this exists on web at all. `initOfflineScanAutoDrain()`
 * registers the flush on the shared outbox signal, and it is called from
 * `features/routes/screens/_layout.tsx:173` — the NATIVE root. Nothing in
 * apps/web calls it. So on web a queued scan sat in MMKV forever: the guest
 * was admitted at the door and never appeared as checked in on the server.
 * This hook is the web half of that wiring, scoped to the screen that needs it
 * rather than bolted onto the Next root, because the door is the only web
 * surface that queues scans.
 *
 * Intervals are the brief's: 180s token refresh, 20s drain while anything is
 * queued. Both are cheap; the token list is a projection of active tickets and
 * the drain is a no-op when the queue is empty.
 */

import { useCallback, useEffect } from "react";
import { create } from "zustand";
import { ticketsApi } from "@dvnt/app/lib/api/tickets";
import {
  useOfflineCheckinStore,
  flushOfflineScansNow,
} from "@dvnt/app/lib/stores/offline-checkin-store";

const TOKEN_REFRESH_MS = 180_000;
const DRAIN_MS = 20_000;

export type DoorSyncPhase = "online" | "offline" | "syncing" | "synced";

interface DoorSyncState {
  phase: DoorSyncPhase;
  /** When the token list was last pulled, or null if never on this device. */
  listUpdatedAt: number | null;
  set: (patch: Partial<Omit<DoorSyncState, "set">>) => void;
}

/** Zustand, like the rest of the screen's state — never useState. */
export const useDoorSyncStore = create<DoorSyncState>((set) => ({
  phase: typeof navigator !== "undefined" && navigator.onLine === false ? "offline" : "online",
  listUpdatedAt: null,
  set: (patch) => set(patch),
}));

export function useDoorOfflineKit(eventId: string) {
  const setSync = useDoorSyncStore((s) => s.set);
  const setTokensForEvent = useOfflineCheckinStore((s) => s.setTokensForEvent);
  const pendingScans = useOfflineCheckinStore((s) => s.pendingScans);
  const queued = pendingScans.filter((p) => p.eventId === eventId).length;

  const refreshTokens = useCallback(async () => {
    if (!eventId || typeof navigator === "undefined" || navigator.onLine === false) return;
    try {
      const tokens = await ticketsApi.downloadOfflineTokens(eventId);
      setTokensForEvent(eventId, tokens);
      setSync({ listUpdatedAt: Date.now() });
    } catch {
      // A failed refresh leaves the PREVIOUS list in place, which is the whole
      // point of having downloaded it. Never surfaced as a scan error.
    }
  }, [eventId, setTokensForEvent, setSync]);

  const drain = useCallback(async () => {
    if (typeof navigator !== "undefined" && navigator.onLine === false) return;
    if (useOfflineCheckinStore.getState().pendingScans.length === 0) return;
    setSync({ phase: "syncing" });
    try {
      await flushOfflineScansNow();
      setSync({
        phase:
          useOfflineCheckinStore.getState().pendingScans.length === 0
            ? "synced"
            : "online",
      });
    } catch {
      setSync({ phase: "online" });
    }
  }, [setSync]);

  // Token list: once on open, then on a timer while there is signal.
  useEffect(() => {
    void refreshTokens();
    const id = window.setInterval(() => void refreshTokens(), TOKEN_REFRESH_MS);
    return () => window.clearInterval(id);
  }, [refreshTokens]);

  // Drain: the moment signal returns, and while anything is still queued.
  useEffect(() => {
    const onOnline = () => {
      setSync({ phase: "online" });
      void drain();
    };
    const onOffline = () => setSync({ phase: "offline" });
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    const id = queued > 0 ? window.setInterval(() => void drain(), DRAIN_MS) : null;
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      if (id !== null) window.clearInterval(id);
    };
  }, [drain, queued, setSync]);

  return { queued, refreshTokens };
}
