import { create } from "zustand";

/**
 * Drawer open state.
 *
 * Zustand rather than `useState` because more than one surface owns it: the
 * header trigger opens it, the panel's rows close it, Android Back closes it,
 * and the sheet coordinator needs to close it before presenting anything over
 * the top. A hook-local state would have to be threaded through all four.
 */
interface DrawerState {
  open: boolean;
  openDrawer: () => void;
  closeDrawer: () => void;
  setOpen: (open: boolean) => void;
}

export const useDrawerStore = create<DrawerState>((set) => ({
  open: false,
  openDrawer: () => set({ open: true }),
  closeDrawer: () => set({ open: false }),
  setOpen: (open) => set({ open }),
}));
