import { create } from "zustand";
import type { OrganizerStatus } from "../api/organizer";

/**
 * Local UI state for the web Organizer Setup screen. The native screen
 * (`app/(protected)/events/organizer-setup.tsx`) keeps its transient flags in
 * `useState`; per the project's Zustand-always rule the web port lifts them
 * into this tiny store. The Connect onboarding/status data still comes from the
 * shared `organizerApi` (sacred data wiring) — this store only owns the
 * screen-local status snapshot + loading/onboarding flags + the optional
 * "notes for Stripe" labeled field.
 */
interface OrganizerSetupUIState {
  status: OrganizerStatus;
  isLoading: boolean;
  isOnboarding: boolean;
  /** Optional organizer note carried into the Stripe-hosted onboarding step. */
  displayName: string;
  setStatus: (status: OrganizerStatus) => void;
  setIsLoading: (v: boolean) => void;
  setIsOnboarding: (v: boolean) => void;
  setDisplayName: (v: string) => void;
  reset: () => void;
}

export const useOrganizerSetupUIStore = create<OrganizerSetupUIState>((set) => ({
  status: { connected: false },
  isLoading: true,
  isOnboarding: false,
  displayName: "",
  setStatus: (status) => set({ status }),
  setIsLoading: (isLoading) => set({ isLoading }),
  setIsOnboarding: (isOnboarding) => set({ isOnboarding }),
  setDisplayName: (displayName) => set({ displayName }),
  reset: () =>
    set({
      status: { connected: false },
      isLoading: true,
      isOnboarding: false,
      displayName: "",
    }),
}));
