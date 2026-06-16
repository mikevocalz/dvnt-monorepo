import { create } from "zustand";

/**
 * Local UI/flow state for the web Ticket Upgrade screen. The native screen
 * (`app/(protected)/ticket/upgrade/[id].tsx`) keeps this in `useState`; per the
 * project's Zustand-always rule the web port lifts it into a store. Mirrors the
 * native transient state: the selected upgrade tier id, the confirm-dialog open
 * flag, the in-flight confirming flag, and the upgrade lifecycle state
 * ("idle" | "redirecting" | "success").
 */
export type UpgradeState = "idle" | "redirecting" | "success";

interface TicketUpgradeUIState {
  selectedTierId: string | null;
  showConfirm: boolean;
  isConfirming: boolean;
  upgradeState: UpgradeState;

  setSelectedTierId: (v: string | null) => void;
  setShowConfirm: (v: boolean) => void;
  setIsConfirming: (v: boolean) => void;
  setUpgradeState: (v: UpgradeState) => void;
  reset: () => void;
}

export const useTicketUpgradeUIStore = create<TicketUpgradeUIState>((set) => ({
  selectedTierId: null,
  showConfirm: false,
  isConfirming: false,
  upgradeState: "idle",

  setSelectedTierId: (v) => set({ selectedTierId: v }),
  setShowConfirm: (v) => set({ showConfirm: v }),
  setIsConfirming: (v) => set({ isConfirming: v }),
  setUpgradeState: (v) => set({ upgradeState: v }),
  reset: () =>
    set({
      selectedTierId: null,
      showConfirm: false,
      isConfirming: false,
      upgradeState: "idle",
    }),
}));
