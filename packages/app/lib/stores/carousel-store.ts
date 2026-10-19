import { create } from "zustand";

/**
 * Active slide index for the web post-detail media carousel. Per project rule,
 * this transient UI state lives in Zustand (not React useState). The owner is
 * the mounted carousel's React ID: a newly opened post starts at zero on its
 * first render, without waiting for an effect to clear a previous post's index.
 */
interface CarouselState {
  index: number;
  owner: string | null;
  setIndex: (index: number, owner: string) => void;
}

export const useCarouselStore = create<CarouselState>((set) => ({
  index: 0,
  owner: null,
  setIndex: (index, owner) => set({ index, owner }),
}));
