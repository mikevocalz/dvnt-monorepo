import { create } from "zustand";
import { persist } from "zustand/middleware";
import { mmkvStorage } from "@dvnt/app/lib/mmkv-zustand";
// Only negative intent survives restart. In particular, an old positive grant
// must not reappear after a failed disk write during emergency withdrawal.
let trustedHydration = false;
const withdrawalStorage: NonNullable<typeof mmkvStorage> = {
  getItem: name => {
    if (!mmkvStorage) throw new Error("Exact distance privacy storage unavailable");
    return mmkvStorage.getItem(name);
  },
  removeItem: name => mmkvStorage?.removeItem(name),
  setItem: (name, value) => {
    if (!trustedHydration) return; // Do not overwrite unreadable denials.
    try { mmkvStorage?.setItem(name, value); } catch {
      // Zustand has already applied the local stop. Disk failure must never
      // interrupt the following authenticated server withdrawal.
    }
  },
};
export const useExactDistanceStore = create<{
  hydrationReady: boolean;
  pendingWithdrawals: Record<string, boolean>;
  beginWithdrawal: (owner: string) => void;
  confirmWithdrawal: (owner: string) => void;
  owner: string | null; sessionKey: string | null; expiresAt: number; generation: number;
  accept: (owner: string, sessionKey: string, expiresAt: number) => void;
  clear: () => void;
}>()(persist((set) => ({
  hydrationReady: false,
  pendingWithdrawals: {},
  beginWithdrawal: (owner) => set(s => ({ owner: null, sessionKey: null, expiresAt: 0,
    generation: s.generation + 1, pendingWithdrawals: { ...s.pendingWithdrawals, [owner]: true } })),
  confirmWithdrawal: (owner) => set(s => { const pendingWithdrawals = { ...s.pendingWithdrawals }; delete pendingWithdrawals[owner]; return { pendingWithdrawals }; }),
  owner: null, sessionKey: null, expiresAt: 0, generation: 0,
  accept: (owner, sessionKey, expiresAt) => set(s => !trustedHydration || s.pendingWithdrawals[owner] ? s : ({ owner, sessionKey, expiresAt, generation: s.generation + 1 })),
  clear: () => set(s => ({ owner: null, sessionKey: null, expiresAt: 0, generation: s.generation + 1 })),
}), { name: "exact-distance-consent-v2", storage: withdrawalStorage,
  partialize: state => ({ pendingWithdrawals: state.pendingWithdrawals }),
  merge: (persisted, current) => {
    if (persisted === undefined) return current;
    const pending = (persisted as { pendingWithdrawals?: unknown })?.pendingWithdrawals;
    if (!pending || typeof pending !== "object" || Array.isArray(pending) ||
        Object.values(pending).some(value => value !== true)) throw new Error("Invalid exact distance withdrawal preferences");
    return { ...current, pendingWithdrawals: pending as Record<string, boolean> };
  },
  onRehydrateStorage: () => (state, error) => { trustedHydration = !!state && !error; if (state) state.hydrationReady = trustedHydration; },
}));
export const EXACT_DISTANCE_COPY = "Allow distances to 0.01 mile for this sign-in. Other eligible verified adults who also opt in can see your distance in feeds and profiles. Repeated distances can reveal your precise location, even though coordinates stay private on the server. You can stop at any time. Your last precise location expires within 15 minutes without a fresh update, including offline sign-out. This is separate from city and map sharing.";
