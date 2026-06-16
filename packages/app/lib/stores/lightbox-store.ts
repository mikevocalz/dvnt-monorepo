import { create } from "zustand";

export type LightboxItem = { type?: string; url: string; poster?: string };

/**
 * Fullscreen media lightbox (web). Opened from event photos + post media; one
 * lightbox at a time. State in Zustand (not useState).
 */
interface LightboxState {
  open: boolean;
  items: LightboxItem[];
  index: number;
  openAt: (items: LightboxItem[], index: number) => void;
  close: () => void;
  next: () => void;
  prev: () => void;
}

export const useLightboxStore = create<LightboxState>((set) => ({
  open: false,
  items: [],
  index: 0,
  openAt: (items, index) => set({ open: true, items, index }),
  close: () => set({ open: false }),
  next: () =>
    set((s) => ({ index: Math.min(s.index + 1, s.items.length - 1) })),
  prev: () => set((s) => ({ index: Math.max(s.index - 1, 0) })),
}));
