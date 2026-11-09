import { create } from "zustand";
import { persist } from "zustand/middleware";
import { mmkvStorage } from "@dvnt/app/lib/mmkv-zustand";
/** New versioned storage, never migrated from coarse proximity consent.
 * Restoring requires the same server-verified sign-in and unexpired lease. */
export const useExactDistanceStore = create<{
  pendingWithdrawals: Record<string, boolean>;
  beginWithdrawal: (owner: string) => void;
  confirmWithdrawal: (owner: string) => void;
  owner: string | null; sessionKey: string | null; expiresAt: number; generation: number;
  accept: (owner: string, sessionKey: string, expiresAt: number) => void;
  clear: () => void;
}>()(persist((set) => ({
  pendingWithdrawals: {},
  beginWithdrawal: (owner) => set(s => ({ owner: null, sessionKey: null, expiresAt: 0,
    generation: s.generation + 1, pendingWithdrawals: { ...s.pendingWithdrawals, [owner]: true } })),
  confirmWithdrawal: (owner) => set(s => { const pendingWithdrawals = { ...s.pendingWithdrawals }; delete pendingWithdrawals[owner]; return { pendingWithdrawals }; }),
  owner: null, sessionKey: null, expiresAt: 0, generation: 0,
  accept: (owner, sessionKey, expiresAt) => set(s => s.pendingWithdrawals[owner] ? s : ({ owner, sessionKey, expiresAt, generation: s.generation + 1 })),
  clear: () => set(s => ({ owner: null, sessionKey: null, expiresAt: 0, generation: s.generation + 1 })),
}), { name: "exact-distance-consent-v2", storage: mmkvStorage }));
export const EXACT_DISTANCE_COPY = "Allow distances to 0.01 mile for this sign-in. Other eligible verified adults who also opt in can see your distance in feeds and profiles. Repeated distances can reveal your precise location, even though coordinates stay private on the server. You can stop at any time. Your last precise location expires within 15 minutes without a fresh update, including offline sign-out. This is separate from city and map sharing.";
