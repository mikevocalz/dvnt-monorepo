import { create } from "zustand";
import { persist } from "zustand/middleware";
import { mmkvStorage } from "@dvnt/app/lib/mmkv-zustand";

let trustedHydration = false;
let storageError: string | null = null;
export const proximityStorageError = () => storageError;
const storage: NonNullable<typeof mmkvStorage> = {
  getItem: (name) => {
    if (!mmkvStorage) throw new Error("Distance privacy storage unavailable");
    return mmkvStorage.getItem(name);
  },
  removeItem: (name) => mmkvStorage?.removeItem(name),
  setItem: (name, value) => {
    if (!trustedHydration) return;
    try {
      if (!mmkvStorage) throw new Error("Distance privacy storage unavailable");
      mmkvStorage.setItem(name, value);
      storageError = null;
    } catch {
      // Stopping locally and contacting the server must survive a disk failure.
      storageError = "Could not save your stop on this device. Keep the app open and retry stopping distance sharing before restarting.";
    }
  },
};

type SyncStatus = { owner: string; sessionKey: string | undefined; epoch: number; busy: boolean; error: string | null };
export const useMemberProximitySyncStore = create<{
  hydrationReady: boolean;
  pendingWithdrawals: Record<string, boolean>;
  status: SyncStatus | null;
  beginWithdrawal: (owner: string) => void;
  confirmWithdrawal: (owner: string) => void;
}>()(persist((set) => ({
  hydrationReady: false,
  pendingWithdrawals: {},
  status: null,
  beginWithdrawal: (owner) => set((state) => state.pendingWithdrawals[owner] ? state : ({
    pendingWithdrawals: { ...state.pendingWithdrawals, [owner]: true },
  })),
  confirmWithdrawal: (owner) => set((state) => {
    const pendingWithdrawals = { ...state.pendingWithdrawals };
    delete pendingWithdrawals[owner];
    return { pendingWithdrawals };
  }),
}), {
  name: "member-proximity-withdrawals",
  storage,
  // Never persist successful publications, coordinates, sessions or grants.
  partialize: (state) => ({ pendingWithdrawals: state.pendingWithdrawals }),
  merge: (persisted, current) => {
    if (persisted === undefined) return current;
    const pending = (persisted as { pendingWithdrawals?: unknown })?.pendingWithdrawals;
    if (!pending || typeof pending !== "object" || Array.isArray(pending) ||
        Object.values(pending).some((value) => value !== true)) throw new Error("Invalid distance withdrawal preferences");
    return { ...current, pendingWithdrawals: pending as Record<string, boolean> };
  },
  onRehydrateStorage: () => (state, error) => {
    trustedHydration = !!state && !error;
    if (state) state.hydrationReady = trustedHydration;
  },
}));
