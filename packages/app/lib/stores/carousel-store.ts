import { create } from "zustand";

/**
 * Active slide index for the web post-detail media carousel. Per project rule,
 * this transient UI state lives in Zustand (not React useState). One detail
 * carousel is open at a time, so a single index suffices.
 */
interface CarouselState {
  index: number;
  setIndex: (index: number) => void;
}

export const useCarouselStore = create<CarouselState>((set) => ({
  index: 0,
  setIndex: (index) => set({ index }),
}));
