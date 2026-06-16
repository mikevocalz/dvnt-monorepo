import { create } from "zustand";

/**
 * Transient UI state for the Host Disputes web screen.
 * Holds the currently-selected dispute id (the row tapped → respond/detail
 * Dialog). Zustand only — never useState (project rule).
 */
interface HostDisputesUIState {
  selectedId: string | null;
  open: (id: string) => void;
  close: () => void;
}

export const useHostDisputesUIStore = create<HostDisputesUIState>((set) => ({
  selectedId: null,
  open: (id) => set({ selectedId: id }),
  close: () => set({ selectedId: null }),
}));
