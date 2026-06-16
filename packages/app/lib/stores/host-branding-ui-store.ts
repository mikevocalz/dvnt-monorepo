import { create } from "zustand";

/**
 * Local UI/form state for the web Host Branding screen. The native screen drives
 * the persisted branding object through `usePaymentsStore` (branding slice) and
 * `brandingApi`; per the project's Zustand-always rule this holds the transient
 * web-only state (freshly-picked logo object URLs + saving flag) instead of
 * `useState`.
 */
interface HostBrandingUIState {
  /** Object URL of a freshly-picked color logo (pre-upload). */
  newLogoUri: string | null;
  /** Object URL of a freshly-picked monochrome logo (pre-upload). */
  newMonochromeUri: string | null;
  isSaving: boolean;

  setNewLogoUri: (v: string | null) => void;
  setNewMonochromeUri: (v: string | null) => void;
  setIsSaving: (v: boolean) => void;
  reset: () => void;
}

const initial = {
  newLogoUri: null as string | null,
  newMonochromeUri: null as string | null,
  isSaving: false,
};

export const useHostBrandingUIStore = create<HostBrandingUIState>((set) => ({
  ...initial,
  setNewLogoUri: (newLogoUri) => set({ newLogoUri }),
  setNewMonochromeUri: (newMonochromeUri) => set({ newMonochromeUri }),
  setIsSaving: (isSaving) => set({ isSaving }),
  reset: () => set(initial),
}));
