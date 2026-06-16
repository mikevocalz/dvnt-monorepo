/**
 * Share Sheet Store
 *
 * Transient UI state for ShareToInboxSheet: the search query and the
 * in-flight send target. Kept in Zustand (not useState) so the sheet can
 * live in a sibling tree from its parent without prop drilling, per the
 * project state policy.
 *
 * NOTE: `conversations` themselves live in React Query (server data). This
 * store only holds ephemeral view state.
 */

import { create } from "zustand";

interface ShareSheetState {
  searchQuery: string;
  sendingTo: string | null;
  setSearchQuery: (q: string) => void;
  setSendingTo: (id: string | null) => void;
  reset: () => void;
}

const initialState = {
  searchQuery: "",
  sendingTo: null as string | null,
};

export const useShareSheetStore = create<ShareSheetState>((set) => ({
  ...initialState,
  setSearchQuery: (q) => set({ searchQuery: q }),
  setSendingTo: (id) => set({ sendingTo: id }),
  reset: () => set(initialState),
}));
