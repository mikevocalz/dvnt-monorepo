/**
 * Offline Check-in Store — MMKV-persisted Zustand store
 *
 * Stores downloaded ticket QR token hashes for offline validation
 * and queues scans for background sync when connectivity resumes.
 *
 * DELIBERATELY a dedicated store, NOT an outbox consumer (WS-8/WS-12
 * decision): the scan queue is shaped for door reconciliation (per-event
 * token allowlists, already-scanned sets), which doesn't fit the generic
 * mutation-entry shape. It DOES share the outbox's drain triggers —
 * `initOfflineScanAutoDrain()` below auto-flushes `pendingScans` on
 * connectivity→online / app foreground via `addOutboxDrainListener`.
 * The manual "Sync" button in organizer screens keeps working unchanged.
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { mmkvStorage } from "@dvnt/app/lib/mmkv-zustand";
import { addOutboxDrainListener } from "@dvnt/app/lib/outbox";
import { isOnline } from "@dvnt/app/lib/stores/connectivity-store";

/** Discriminates the rail a queued scan belongs to (WS-8 × WS-3). */
export type OfflineScanKind = "ticket" | "addon";

interface PendingScan {
  qrToken: string;
  scannedAt: string; // ISO timestamp
  eventId: string;
  scannedBy?: string;
  /** Absent on legacy persisted entries — treat as "ticket". */
  kind?: OfflineScanKind;
}

interface OfflineCheckinState {
  // Map of eventId → Set of valid QR tokens (downloaded for offline use)
  tokensByEvent: Record<string, string[]>;
  // Map of eventId → redeemable add-on QR tokens (order_addons allowlist)
  addonTokensByEvent: Record<string, string[]>;
  // Set of tokens already scanned offline (per event, both rails)
  scannedTokens: Record<string, string[]>;
  // Pending scans to sync when back online
  pendingScans: PendingScan[];
  // Last download timestamp per event
  lastDownloaded: Record<string, string>;

  // Actions
  setTokensForEvent: (eventId: string, tokens: string[]) => void;
  setAddonTokensForEvent: (eventId: string, tokens: string[]) => void;
  markScannedOffline: (
    eventId: string,
    qrToken: string,
    scannedBy?: string,
    kind?: OfflineScanKind,
  ) => void;
  /**
   * Record a token as scanned WITHOUT queueing a pending sync — used after
   * an ONLINE scan succeeds so a re-scan of the same QR flips the duplicate
   * UI instantly from local knowledge (<300ms first paint) before the
   * server confirms.
   */
  markScannedLocal: (eventId: string, qrToken: string) => void;
  removePendingScans: (eventId: string, tokens: string[]) => void;
  clearEventData: (eventId: string) => void;
  isTokenValid: (eventId: string, qrToken: string) => boolean;
  isAddonTokenValid: (eventId: string, qrToken: string) => boolean;
  isAlreadyScanned: (eventId: string, qrToken: string) => boolean;
  hasOfflineData: (eventId: string) => boolean;
}

export const useOfflineCheckinStore = create<OfflineCheckinState>()(
  persist(
    (set, get) => ({
      tokensByEvent: {},
      addonTokensByEvent: {},
      scannedTokens: {},
      pendingScans: [],
      lastDownloaded: {},

      setTokensForEvent: (eventId, tokens) =>
        set((state) => ({
          tokensByEvent: { ...state.tokensByEvent, [eventId]: tokens },
          lastDownloaded: {
            ...state.lastDownloaded,
            [eventId]: new Date().toISOString(),
          },
        })),

      setAddonTokensForEvent: (eventId, tokens) =>
        set((state) => ({
          addonTokensByEvent: {
            ...state.addonTokensByEvent,
            [eventId]: tokens,
          },
        })),

      markScannedOffline: (eventId, qrToken, scannedBy, kind = "ticket") =>
        set((state) => {
          const existing = state.scannedTokens[eventId] || [];
          if (existing.includes(qrToken)) return state; // already scanned
          return {
            scannedTokens: {
              ...state.scannedTokens,
              [eventId]: [...existing, qrToken],
            },
            pendingScans: [
              ...state.pendingScans,
              {
                qrToken,
                scannedAt: new Date().toISOString(),
                eventId,
                scannedBy,
                kind,
              },
            ],
          };
        }),

      markScannedLocal: (eventId, qrToken) =>
        set((state) => {
          const existing = state.scannedTokens[eventId] || [];
          if (existing.includes(qrToken)) return state;
          return {
            scannedTokens: {
              ...state.scannedTokens,
              [eventId]: [...existing, qrToken],
            },
          };
        }),

      removePendingScans: (eventId, tokens) =>
        set((state) => ({
          pendingScans: state.pendingScans.filter(
            (s) => !(s.eventId === eventId && tokens.includes(s.qrToken)),
          ),
        })),

      clearEventData: (eventId) =>
        set((state) => {
          const { [eventId]: _t, ...restTokens } = state.tokensByEvent;
          const { [eventId]: _a, ...restAddonTokens } =
            state.addonTokensByEvent;
          const { [eventId]: _s, ...restScanned } = state.scannedTokens;
          const { [eventId]: _d, ...restDownloaded } = state.lastDownloaded;
          return {
            tokensByEvent: restTokens,
            addonTokensByEvent: restAddonTokens,
            scannedTokens: restScanned,
            lastDownloaded: restDownloaded,
            pendingScans: state.pendingScans.filter(
              (s) => s.eventId !== eventId,
            ),
          };
        }),

      isTokenValid: (eventId, qrToken) => {
        const tokens = get().tokensByEvent[eventId];
        return tokens ? tokens.includes(qrToken) : false;
      },

      isAddonTokenValid: (eventId, qrToken) => {
        const tokens = get().addonTokensByEvent[eventId];
        return tokens ? tokens.includes(qrToken) : false;
      },

      isAlreadyScanned: (eventId, qrToken) => {
        const scanned = get().scannedTokens[eventId];
        return scanned ? scanned.includes(qrToken) : false;
      },

      hasOfflineData: (eventId) => {
        const tokens = get().tokensByEvent[eventId];
        const addonTokens = get().addonTokensByEvent[eventId];
        return (
          (Array.isArray(tokens) && tokens.length > 0) ||
          (Array.isArray(addonTokens) && addonTokens.length > 0)
        );
      },
    }),
    {
      name: "offline-checkin-store",
      storage: mmkvStorage,
    },
  ),
);

// ─── Auto-drain wiring (WS-12 first consumer) ───────────────────────────────

let _autoDrainInitialized = false;
let _flushing = false;

/**
 * Flush pendingScans to the server, preserving retained-on-failure
 * semantics: only scans the server acknowledged are removed; failed ones
 * stay queued for the next trigger (exactly what the manual button does).
 */
async function flushPendingScans(): Promise<void> {
  if (_flushing) return;
  const { pendingScans, removePendingScans } =
    useOfflineCheckinStore.getState();
  if (pendingScans.length === 0 || !isOnline()) return;
  _flushing = true;
  try {
    // Lazy import keeps the API layer (supabase client, auth) out of this
    // store's module graph at boot.
    const { ticketsApi } = await import("@dvnt/app/lib/api/tickets");
    const result = await ticketsApi.syncOfflineScans(pendingScans);
    if (result.synced.length > 0) {
      // removePendingScans is (eventId, tokens) — group synced tokens by event.
      const byEvent = new Map<string, string[]>();
      for (const scan of pendingScans) {
        if (!result.synced.includes(scan.qrToken)) continue;
        const list = byEvent.get(scan.eventId) ?? [];
        list.push(scan.qrToken);
        byEvent.set(scan.eventId, list);
      }
      for (const [eventId, tokens] of byEvent) {
        removePendingScans(eventId, tokens);
      }
    }
    if (result.failed.length > 0) {
      console.warn(
        `[OfflineCheckin] auto-drain: ${result.failed.length} scan(s) failed to sync — retained for next attempt`,
      );
    }
  } catch (e) {
    // Whole-batch failure (e.g. no session) — queue stays intact.
    console.warn("[OfflineCheckin] auto-drain failed (scans retained):", e);
  } finally {
    _flushing = false;
  }
}

/**
 * Public one-shot flush for the WS-11 scan-queue-flush background job.
 * Drains pendingScans via `ticketsApi.syncOfflineScans` exactly like the
 * foreground auto-drain — same retained-on-failure semantics, same in-flight
 * guard. Idempotent and never throws.
 */
export async function flushOfflineScansNow(): Promise<void> {
  await flushPendingScans();
}

/**
 * Idempotent bootstrap — call once from the root layout, next to
 * initOutboxDrain(). Registers the scan flush on the shared outbox drain
 * signal (connectivity→online + AppState foreground). Never throws.
 */
export function initOfflineScanAutoDrain(): void {
  if (_autoDrainInitialized) return;
  _autoDrainInitialized = true;
  try {
    addOutboxDrainListener(flushPendingScans);
  } catch (e) {
    console.warn(
      "[OfflineCheckin] auto-drain init failed (manual sync still works):",
      e,
    );
  }
}
