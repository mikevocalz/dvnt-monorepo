import { create } from "zustand";

/**
 * Local UI state for the web Host Bank & Verification screen. The native screen
 * (`app/settings/host-bank-verification.tsx`) keeps the transient "refreshing"
 * flag in `useState`; per the project's Zustand-always rule the web port lifts
 * it into a tiny store. Connect account data + the connect/onboarding loading
 * flags continue to live in the shared `payments-store` (sacred data wiring) —
 * this store only owns the screen-local refresh flag.
 */
interface HostBankVerificationUIState {
  refreshing: boolean;
  setRefreshing: (v: boolean) => void;
  reset: () => void;
}

export const useHostBankVerificationUIStore =
  create<HostBankVerificationUIState>((set) => ({
    refreshing: false,
    setRefreshing: (refreshing) => set({ refreshing }),
    reset: () => set({ refreshing: false }),
  }));
