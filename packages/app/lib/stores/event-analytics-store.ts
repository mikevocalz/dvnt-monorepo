import { create } from "zustand"

/**
 * Event analytics screen UI state (web). Project rule: screen-local UI state
 * lives in Zustand, never useState. The native screen is a single summary; the
 * web port adds a lightweight view tab ("overview" / "tiers") so the heavier
 * breakdowns can be toggled, plus the CSV-export busy flag (native used
 * useState for `isExporting` — web routes it through the store to honor the
 * no-useState rule). None of this changes the server contract.
 */
export type EventAnalyticsTab = "overview" | "tiers"

interface EventAnalyticsState {
  tab: EventAnalyticsTab
  isExporting: boolean
  setTab: (tab: EventAnalyticsTab) => void
  setExporting: (isExporting: boolean) => void
  reset: () => void
}

export const useEventAnalyticsStore = create<EventAnalyticsState>((set) => ({
  tab: "overview",
  isExporting: false,
  setTab: (tab) => set({ tab }),
  setExporting: (isExporting) => set({ isExporting }),
  reset: () => set({ tab: "overview", isExporting: false }),
}))
