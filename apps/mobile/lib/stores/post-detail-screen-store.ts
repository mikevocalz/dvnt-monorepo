/**
 * Post Detail Screen Store
 * 
 * Zustand store for post detail screen ephemeral UI state.
 * Replaces useState calls to comply with project mandate.
 * 
 * CRITICAL: All screen-specific state must use Zustand, not useState.
 */

import { create } from "zustand";

interface PostDetailScreenState {
  // Action sheet state
  showActionSheet: boolean;
  
  // Carousel state for multi-image posts
  currentSlide: number;
  
  // Actions
  setShowActionSheet: (show: boolean) => void;
  setCurrentSlide: (slide: number) => void;
  
  // Reset all state when leaving screen
  resetPostDetailScreen: () => void;
}

const initialState = {
  showActionSheet: false,
  currentSlide: 0,
};

export const usePostDetailScreenStore = create<PostDetailScreenState>((set) => ({
  ...initialState,

  setShowActionSheet: (show) => set({ showActionSheet: show }),
  
  setCurrentSlide: (slide) => set({ currentSlide: slide }),
  
  resetPostDetailScreen: () => set(initialState),
}));
