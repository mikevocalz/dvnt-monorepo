import { create } from "zustand";

export type TicketsTab = "upcoming" | "past";

interface MyTicketsTabState {
  activeTab: TicketsTab;
  setActiveTab: (tab: TicketsTab) => void;
}

/** Active upcoming/past tab for the My Tickets web screen (Zustand, never useState). */
export const useMyTicketsTabStore = create<MyTicketsTabState>((set) => ({
  activeTab: "upcoming",
  setActiveTab: (tab) => set({ activeTab: tab }),
}));
