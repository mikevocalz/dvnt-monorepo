import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { storage } from "@/lib/utils/storage";

/**
 * STABILIZED Bookmark Store
 *
 * CRITICAL RULES:
 * 1. NO toggleBookmark - use setBookmarked with server values
 * 2. Server is single source of truth
 * 3. Sync from server replaces local state entirely
 */
interface BookmarkState {
  bookmarkedPosts: string[];
  // Server-driven setter (NOT toggle)
  setBookmarked: (postId: string, bookmarked: boolean) => void;
  // Read-only check
  isBookmarked: (postId: string) => boolean;
  getBookmarkedPostIds: () => string[];
  // Sync from server - replaces local state entirely
  syncBookmarks: (serverBookmarks: string[]) => void;
  // Clear all state (for logout)
  clearAll: () => void;
}

export const useBookmarkStore = create<BookmarkState>()(
  persist(
    (set, get) => ({
      bookmarkedPosts: [],

      // Set bookmark state from server response - NOT a toggle
      setBookmarked: (postId, bookmarked) => {
        const { bookmarkedPosts } = get();
        const isCurrentlyBookmarked = bookmarkedPosts.includes(postId);

        if (bookmarked && !isCurrentlyBookmarked) {
          set({ bookmarkedPosts: [...bookmarkedPosts, postId] });
        } else if (!bookmarked && isCurrentlyBookmarked) {
          set({
            bookmarkedPosts: bookmarkedPosts.filter((id) => id !== postId),
          });
        }
        // If state already matches, do nothing (idempotent)
      },

      isBookmarked: (postId) => get().bookmarkedPosts.includes(postId),
      getBookmarkedPostIds: () => get().bookmarkedPosts,

      // Replace local state entirely with server truth
      syncBookmarks: (serverBookmarks) => {
        set({ bookmarkedPosts: serverBookmarks });
      },

      // Clear all state on logout
      clearAll: () => {
        set({ bookmarkedPosts: [] });
      },
    }),
    {
      name: "bookmark-storage",
      storage: createJSONStorage(() => storage),
      // CRITICAL: Don't persist user-specific bookmarks across logins
      // This prevents User B from seeing User A's bookmarks
      partialize: (state) => ({
        // Bookmarks are server state - fetch fresh on each login
        // Don't persist anything from this store
      }),
    },
  ),
);
