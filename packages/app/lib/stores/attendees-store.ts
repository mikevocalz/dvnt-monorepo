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
  /**
   * Comp form. The modal is a child of this screen, so its draft lives here
   * rather than in a second store — one `closeComp()` clears the whole form.
   * Server state (tiers, the comp result) is NOT here; that is TanStack Query.
   */
  compOpen: boolean
  compTierId: string | null
  compRecipients: string
  compNote: string
  setStatusFilter: (value: AttendeesStatusFilter) => void
  setSearchInput: (value: string) => void
  openComp: () => void
  closeComp: () => void
  setCompTierId: (value: string | null) => void
  /** Username autocomplete draft for the comp sheet. */
  compUserQuery: string;
  setCompUserQuery: (v: string) => void;
  setCompRecipients: (value: string) => void
  setCompNote: (value: string) => void
  reset: () => void
}

const EMPTY_COMP = {
  compOpen: false,
  compTierId: null,
  compRecipients: "",
  compUserQuery: "",
  compNote: "",
} as const

export const useAttendeesStore = create<AttendeesState>((set) => ({
  statusFilter: "all",
  searchInput: "",
  ...EMPTY_COMP,
  setStatusFilter: (statusFilter) => set({ statusFilter }),
  setSearchInput: (searchInput) => set({ searchInput }),
  openComp: () => set({ ...EMPTY_COMP, compOpen: true }),
  closeComp: () => set(EMPTY_COMP),
  setCompTierId: (compTierId) => set({ compTierId }),
  setCompRecipients: (compRecipients) => set({ compRecipients }),
  setCompUserQuery: (compUserQuery) => set({ compUserQuery }),
  setCompNote: (compNote) => set({ compNote }),
  reset: () => set({ statusFilter: "all", searchInput: "", ...EMPTY_COMP }),
}))
