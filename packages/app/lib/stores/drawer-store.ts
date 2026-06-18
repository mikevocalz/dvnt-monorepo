import { create } from "zustand";

// Global state for the app's slide-over navigation drawer. Kept tiny and
// app-wide so the hamburger (in the tab header) and the drawer overlay (mounted
// once in the protected layout) share one source of truth.
interface DrawerState {
  open: boolean;
  openDrawer: () => void;
  closeDrawer: () => void;
  toggleDrawer: () => void;
}

export const useDrawerStore = create<DrawerState>((set) => ({
  open: false,
  openDrawer: () => set({ open: true }),
  closeDrawer: () => set({ open: false }),
  toggleDrawer: () => set((s) => ({ open: !s.open })),
}));
