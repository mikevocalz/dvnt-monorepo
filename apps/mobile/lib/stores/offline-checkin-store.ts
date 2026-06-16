/**
 * Offline Check-in Store — MMKV-persisted Zustand store
 *
 * Stores downloaded ticket QR token hashes for offline validation
 * and queues scans for background sync when connectivity resumes.
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { mmkvStorage } from "@/lib/mmkv-zustand";

interface PendingScan {
  qrToken: string;
  scannedAt: string; // ISO timestamp
  eventId: string;
  scannedBy?: string;
}

interface OfflineCheckinState {
  // Map of eventId → Set of valid QR tokens (downloaded for offline use)
  tokensByEvent: Record<string, string[]>;
  // Set of tokens already scanned offline (per event)
  scannedTokens: Record<string, string[]>;
  // Pending scans to sync when back online
  pendingScans: PendingScan[];
  // Last download timestamp per event
  lastDownloaded: Record<string, string>;

  // Actions
  setTokensForEvent: (eventId: string, tokens: string[]) => void;
  markScannedOffline: (eventId: string, qrToken: string, scannedBy?: string) => void;
  removePendingScans: (eventId: string, tokens: string[]) => void;
  clearEventData: (eventId: string) => void;
  isTokenValid: (eventId: string, qrToken: string) => boolean;
  isAlreadyScanned: (eventId: string, qrToken: string) => boolean;
  hasOfflineData: (eventId: string) => boolean;
}

export const useOfflineCheckinStore = create<OfflineCheckinState>()(
  persist(
    (set, get) => ({
      tokensByEvent: {},
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

      markScannedOffline: (eventId, qrToken, scannedBy) =>
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
              },
            ],
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
          const { [eventId]: _s, ...restScanned } = state.scannedTokens;
          const { [eventId]: _d, ...restDownloaded } = state.lastDownloaded;
          return {
            tokensByEvent: restTokens,
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

      isAlreadyScanned: (eventId, qrToken) => {
        const scanned = get().scannedTokens[eventId];
        return scanned ? scanned.includes(qrToken) : false;
      },

      hasOfflineData: (eventId) => {
        const tokens = get().tokensByEvent[eventId];
        return Array.isArray(tokens) && tokens.length > 0;
      },
    }),
    {
      name: "offline-checkin-store",
      storage: mmkvStorage,
    },
  ),
);
