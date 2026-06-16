/**
 * Zustand store for post tag UI state (visibility toggle per post).
 * Tags are shown/hidden by tapping the image — Instagram behavior.
 */

import { create } from "zustand";

interface PostTagsUIState {
  // Map of postId → whether tags are currently visible
  visibleTags: Record<string, boolean>;

  // Toggle tag visibility for a post (tap image to show/hide)
  toggleTags: (postId: string) => void;

  // Explicitly set visibility
  setTagsVisible: (postId: string, visible: boolean) => void;

  // Hide all tags (e.g. when scrolling away)
  hideAllTags: () => void;

  // Check if tags are visible for a post
  isVisible: (postId: string) => boolean;
}

export const usePostTagsUIStore = create<PostTagsUIState>((set, get) => ({
  visibleTags: {},

  toggleTags: (postId: string) =>
    set((state) => ({
      visibleTags: {
        ...state.visibleTags,
        [postId]: !state.visibleTags[postId],
      },
    })),

  setTagsVisible: (postId: string, visible: boolean) =>
    set((state) => ({
      visibleTags: {
        ...state.visibleTags,
        [postId]: visible,
      },
    })),

  hideAllTags: () => set({ visibleTags: {} }),

  isVisible: (postId: string) => !!get().visibleTags[postId],
}));
