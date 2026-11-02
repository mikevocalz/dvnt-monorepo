import { create } from "zustand"

/**
 * Event analytics screen UI state (web). Project rule: screen-local UI state
 * lives in Zustand, never useState. The native screen is a single summary; the
 * web port adds a lightweight view tab ("overview" / "tiers") so the heavier
 * breakdowns can be toggled, plus the CSV-export busy flag (native used
 * useState for `isExporting` — web routes it through the store to honor the
 * no-useState rule). None of this changes the server contract.
 */
export const currentAccountingMonth = () => {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit' }).formatToParts(new Date());
  const year = parts.find(p => p.type === 'year')?.value;
  const month = parts.find(p => p.type === 'month')?.value;
  return `${year}-${month}`;
}

export type EventAnalyticsTab = "overview" | "tiers"

interface EventAnalyticsState {
  tab: EventAnalyticsTab
  isExporting: boolean
  month: string
  setMonth: (month: string) => void
  setTab: (tab: EventAnalyticsTab) => void
  setExporting: (isExporting: boolean) => void
  reset: () => void
}

export const useEventAnalyticsStore = create<EventAnalyticsState>((set) => ({
  tab: "overview",
  isExporting: false,
  month: currentAccountingMonth(),
  setMonth: (month) => { if (/^20\d{2}-(0[1-9]|1[0-2])$/.test(month) && month <= currentAccountingMonth()) set({ month }) },
  setTab: (tab) => set({ tab }),
  setExporting: (isExporting) => set({ isExporting }),
  reset: () => set({ tab: "overview", isExporting: false, month: currentAccountingMonth() }),
}))
