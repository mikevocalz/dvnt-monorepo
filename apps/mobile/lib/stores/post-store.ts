import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { storage } from "@/lib/utils/storage";

interface FeedSlideState {
  currentSlides: Record<string, number>;
  setCurrentSlide: (postId: string, slide: number) => void;
}

export const useFeedSlideStore = create<FeedSlideState>((set) => ({
  currentSlides: {},
  setCurrentSlide: (postId, slide) =>
    set((state) => ({
      currentSlides: { ...state.currentSlides, [postId]: slide },
    })),
}));

/**
 * STABILIZED Post Store
 *
 * CRITICAL RULES:
 * 1. NO client-side count manipulation - counts come from server ONLY
 * 2. Boolean states (liked/bookmarked) synced from server
 * 3. NO toggleLike/toggleBookmark - use setLiked/setBookmarked with server values
 * 4. Comment counts tracked for UI updates only
 */
interface PostState {
  // Liked posts - SET by server, not toggled
  likedPosts: string[];
  // Liked comments - SET by server, not toggled
  likedComments: string[];
  // Comment counts - for UI updates when new comments are added
  postCommentCounts: Record<string, number>;

  // Server-driven setters (NOT toggles)
  setPostLiked: (postId: string, liked: boolean) => void;
  setCommentLiked: (commentId: string, liked: boolean) => void;

  // Read-only checks
  isPostLiked: (postId: string) => boolean;
  isCommentLiked: (commentId: string) => boolean;

  // Sync from server - replaces local state entirely
  syncLikedPosts: (serverLikedPosts: string[]) => void;
  syncLikedComments: (serverLikedComments: string[]) => void;

  // Comment count tracking (for optimistic comment creation only)
  setCommentCount: (postId: string, count: number) => void;
  getCommentCount: (postId: string, fallback: number) => number;

  // Clear all state (for logout)
  clearAll: () => void;
}

export const usePostStore = create<PostState>()(
  persist(
    (set, get) => ({
      likedPosts: [],
      likedComments: [],
      postCommentCounts: {},

      // Set liked state from server response - NOT a toggle
      setPostLiked: (postId, liked) => {
        const { likedPosts } = get();
        const isCurrentlyLiked = likedPosts.includes(postId);

        if (liked && !isCurrentlyLiked) {
          set({ likedPosts: [...likedPosts, postId] });
        } else if (!liked && isCurrentlyLiked) {
          set({ likedPosts: likedPosts.filter((id) => id !== postId) });
        }
        // If state already matches, do nothing (idempotent)
      },

      // Set comment liked state from server response - NOT a toggle
      setCommentLiked: (commentId, liked) => {
        const { likedComments } = get();
        const isCurrentlyLiked = likedComments.includes(commentId);

        if (liked && !isCurrentlyLiked) {
          set({ likedComments: [...likedComments, commentId] });
        } else if (!liked && isCurrentlyLiked) {
          set({
            likedComments: likedComments.filter((id) => id !== commentId),
          });
        }
      },

      isPostLiked: (postId) => get().likedPosts.includes(postId),
      isCommentLiked: (commentId) => get().likedComments.includes(commentId),

      // Replace local state entirely with server truth
      syncLikedPosts: (serverLikedPosts) => {
        set({ likedPosts: serverLikedPosts });
      },

      syncLikedComments: (serverLikedComments) => {
        set({ likedComments: serverLikedComments });
      },

      // Comment count tracking
      setCommentCount: (postId, count) => {
        set((state) => ({
          postCommentCounts: { ...state.postCommentCounts, [postId]: count },
        }));
      },

      getCommentCount: (postId, fallback) => {
        return get().postCommentCounts[postId] ?? fallback;
      },

      // Clear all state on logout
      clearAll: () => {
        set({
          likedPosts: [],
          likedComments: [],
          postCommentCounts: {},
        });
      },
    }),
    {
      name: "post-storage",
      storage: createJSONStorage(() => storage),
      // CRITICAL: Don't persist user-specific state across logins
      // This prevents User B from seeing User A's liked posts
      partialize: (state) => ({
        // Only persist UI state, not user-specific server state
        // likedPosts and likedComments should come from server on each login
        postCommentCounts: state.postCommentCounts,
      }),
    },
  ),
);
