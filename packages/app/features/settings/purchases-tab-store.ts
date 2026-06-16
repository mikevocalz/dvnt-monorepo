import { create } from "zustand";

export type PurchasesTab = "all" | "paid" | "refunded";

interface PurchasesTabState {
  activeTab: PurchasesTab;
  setActiveTab: (tab: PurchasesTab) => void;
}

/**
 * Active status filter for the Purchases web screen.
 * Zustand only — never useState (project rule).
 */
export const usePurchasesTabStore = create<PurchasesTabState>((set) => ({
  activeTab: "all",
  setActiveTab: (tab) => set({ activeTab: tab }),
}));
