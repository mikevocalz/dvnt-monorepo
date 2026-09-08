import { create } from "zustand";

/**
 * Inbox sheet state — which composer sheet is open, and the New Message
 * sheet's own field state.
 *
 * Zustand, not `useState`: this repo keeps ALL state in stores. Beyond the
 * house rule it removes a whole class of bug — a `useState` has to be declared
 * above every early return in its component, and the inbox early-returns a
 * skeleton while loading, so a hook added lower down crashed the screen with
 * "Rendered more hooks than during the previous render". Store reads are hooks
 * too, but they live at the top with the rest and never move.
 */
interface MessagesSheetsState {
  newMessageOpen: boolean;
  newGroupOpen: boolean;
  /** New Message sheet's search field. */
  searchQuery: string;
  /** A conversation is being created — guards double-taps. */
  isCreating: boolean;
  setNewMessageOpen: (open: boolean) => void;
  setNewGroupOpen: (open: boolean) => void;
  setSearchQuery: (q: string) => void;
  setIsCreating: (v: boolean) => void;
  /** Clear the New Message sheet so it opens fresh next time. */
  resetNewMessage: () => void;
}

export const useMessagesSheetsStore = create<MessagesSheetsState>((set) => ({
  newMessageOpen: false,
  newGroupOpen: false,
  searchQuery: "",
  isCreating: false,
  setNewMessageOpen: (newMessageOpen) => set({ newMessageOpen }),
  setNewGroupOpen: (newGroupOpen) => set({ newGroupOpen }),
  setSearchQuery: (searchQuery) => set({ searchQuery }),
  setIsCreating: (isCreating) => set({ isCreating }),
  resetNewMessage: () => set({ searchQuery: "", isCreating: false }),
}));
