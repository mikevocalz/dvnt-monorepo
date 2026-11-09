import { create } from "zustand";

interface FeedScrollState {
  scrollToTopTrigger: number;
  triggerScrollToTop: () => void;
  consumedTrigger: number;
  consumeScrollToTop: (trigger: number) => void;
}

export const useFeedScrollStore = create<FeedScrollState>((set) => ({
  scrollToTopTrigger: 0,
  consumedTrigger: 0,
  consumeScrollToTop: (trigger) => set({ consumedTrigger: trigger }),
  triggerScrollToTop: () =>
    set((state) => ({ scrollToTopTrigger: state.scrollToTopTrigger + 1 })),
}));
