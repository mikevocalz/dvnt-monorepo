import { create } from "zustand";
import { persist } from "zustand/middleware";
import { mmkvStorage } from "@dvnt/app/lib/mmkv-zustand";
import type { LocationSettings } from "@dvnt/app/lib/api/member-map";
import { acceptSettings } from "@dvnt/app/lib/location/location-access";

let trustedHydration = false;
let durabilityError: string | null = null;
export function locationDurabilityError() { return durabilityError; }
// Emergency server withdrawal must still run if local disk is full/unavailable.
const withdrawalStorage: typeof mmkvStorage = mmkvStorage && {
  getItem: (name) => mmkvStorage.getItem(name),
  removeItem: (name) => mmkvStorage.removeItem(name),
  setItem: (name, value) => {
    // Never erase unreadable denial records with an empty fallback snapshot.
    if (!trustedHydration) return;
    try { mmkvStorage.setItem(name, value); durabilityError = null; }
    catch { durabilityError = "Privacy preference could not be saved on this device. Keep the app open and retry turning location off before restarting."; }
  },
};
interface LocationAccessState {
  owner: string | null;
  settings: LocationSettings | null;
  blocked: boolean;
  hydrationReady: boolean;
  avatarSessionActive: boolean;
  activateAvatarSession: (owner: string) => void;
  pendingWithdrawal: boolean;
  pendingWithdrawals: Record<string, { revision: number }>;
  generation: number;
  error: string | null;
  selectOwner: (owner: string | null) => void;
  accept: (owner: string, settings: LocationSettings, unblock?: boolean, confirmedGeneration?: number) => void;
  stop: (error?: string | null, pendingWithdrawal?: boolean) => void;
}
// Persist only negative consent intent. Never persist grants, settings or coordinates.
// The existing MMKV adapter hydrates synchronously before any account query can unblock.
const withdrawalWarning = "Could not confirm server withdrawal. Your device has stopped updating. Retry turning sharing off.";
export const useLocationAccessStore = create<LocationAccessState>()(persist((set) => ({
  owner: null, settings: null, avatarSessionActive: false, blocked: true, hydrationReady: false, pendingWithdrawal: false, pendingWithdrawals: {}, generation: 0, error: null,
  activateAvatarSession: (owner) => set((state) => state.owner === owner && !state.blocked && state.hydrationReady ? { avatarSessionActive: true } : state),
  selectOwner: (owner) => set((state) => {
    if (state.owner === owner) return state;
    const pendingWithdrawal = !!owner && !!state.pendingWithdrawals[owner];
    return { owner, settings: null, avatarSessionActive: false, blocked: true, pendingWithdrawal, generation: state.generation + 1, error: !state.hydrationReady ? "Location privacy preferences could not be read. Location remains off." : pendingWithdrawal ? withdrawalWarning : null };
  }),
  accept: (owner, settings, unblock = false, confirmedGeneration) => set((state) => {
    if (state.owner !== owner || !acceptSettings(state.settings, settings)) return state;
    const pendingWithdrawals = { ...state.pendingWithdrawals };
    if (confirmedGeneration === state.generation) delete pendingWithdrawals[owner];
    const pendingWithdrawal = !!pendingWithdrawals[owner];
    return { settings, pendingWithdrawals, pendingWithdrawal, blocked: unblock && state.hydrationReady && !pendingWithdrawal ? false : state.blocked, error: unblock && state.hydrationReady && !pendingWithdrawal ? null : state.error };
  }),
  stop: (error = null, pendingWithdrawal = false) => set((state) => ({
    blocked: true, avatarSessionActive: false,
    pendingWithdrawal: state.pendingWithdrawal || pendingWithdrawal,
    pendingWithdrawals: pendingWithdrawal && state.owner ? { ...state.pendingWithdrawals, [state.owner]: { revision: state.settings?.revision ?? 0 } } : state.pendingWithdrawals,
    generation: state.generation + 1,
    error: error ?? (state.pendingWithdrawal ? state.error : null),
  })),
}), { name: "member-map-withdrawal-intents", storage: withdrawalStorage, partialize: (state) => ({ pendingWithdrawals: state.pendingWithdrawals }),
  merge: (persisted, current) => {
    if (persisted === undefined) return current;
    const pending = (persisted as { pendingWithdrawals?: unknown })?.pendingWithdrawals;
    if (!pending || typeof pending !== "object" || Array.isArray(pending) || Object.values(pending).some((value) => !value || typeof value !== "object" || !Number.isSafeInteger((value as { revision: number }).revision) || (value as { revision: number }).revision < 0)) throw new Error("Invalid location withdrawal preferences");
    return { ...current, pendingWithdrawals: pending as LocationAccessState["pendingWithdrawals"] };
  },
  onRehydrateStorage: () => (state, error) => { if (state && !error) { trustedHydration = true; state.hydrationReady = true; } }, }));
export function locationAllowedFor(owner: string | null | undefined): boolean {
  const state = useLocationAccessStore.getState();
  return !!owner && state.owner === owner && state.hydrationReady && !state.blocked && state.settings?.locationEnabled === true;
}
