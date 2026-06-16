import { create } from "zustand"

/**
 * Attendees roster UI state (web). Project rule: screen-local UI state lives
 * in Zustand, never useState. Mirrors the native attendees screen's local
 * controls: the status filter chip and the (un-debounced) search input. The
 * 200ms debounce is applied at the consumer via @tanstack/react-pacer, exactly
 * like native.
 */
export type AttendeesStatusFilter =
  | "all"
  | "active"
  | "scanned"
  | "refunded"
  | "transfer_pending"
  | "void"

interface AttendeesState {
  statusFilter: AttendeesStatusFilter
  searchInput: string
  setStatusFilter: (value: AttendeesStatusFilter) => void
  setSearchInput: (value: string) => void
  reset: () => void
}

export const useAttendeesStore = create<AttendeesState>((set) => ({
  statusFilter: "all",
  searchInput: "",
  setStatusFilter: (statusFilter) => set({ statusFilter }),
  setSearchInput: (searchInput) => set({ searchInput }),
  reset: () => set({ statusFilter: "all", searchInput: "" }),
}))
