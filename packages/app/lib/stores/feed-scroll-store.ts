import { create } from "zustand";

interface FeedScrollState {
  scrollToTopTrigger: number;
  triggerScrollToTop: () => void;
}

export const useFeedScrollStore = create<FeedScrollState>((set) => ({
  scrollToTopTrigger: 0,
  triggerScrollToTop: () =>
    set((state) => ({ scrollToTopTrigger: state.scrollToTopTrigger + 1 })),
}));
