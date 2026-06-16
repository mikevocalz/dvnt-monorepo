/**
 * Bookmarks Hook
 *
 * STABILIZED: Provides React Query hooks for managing bookmarks
 * - Server is single source of truth
 * - Syncs to Zustand store for offline access
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { bookmarksApi } from "@dvnt/app/lib/api/bookmarks";
import { useUIStore } from "@dvnt/app/lib/stores/ui-store";
import { useBookmarkStore } from "@dvnt/app/lib/stores/bookmark-store";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import { STALE_TIMES, GC_TIMES } from "@dvnt/app/lib/perf/stale-time-config";

// Query keys - scoped by viewerId for cache isolation
export const bookmarkKeys = {
  all: ["bookmarks"] as const,
  list: (viewerId?: string) =>
    [...bookmarkKeys.all, "list", viewerId || "__no_user__"] as const,
};

// Fetch bookmarked posts and sync to store
export function useBookmarks() {
  const user = useAuthStore((s) => s.user);
  const viewerId = user?.id;

  return useQuery({
    queryKey: bookmarkKeys.list(),
    queryFn: () => bookmarksApi.getBookmarks(),
    staleTime: STALE_TIMES.bookmarks,
    gcTime: GC_TIMES.standard,
    // Inherits global refetchOnMount: false
    enabled: !!viewerId,
  });
}

/**
 * Fetch bookmarked posts ALREADY HYDRATED in a single round trip.
 *
 * Use this for the profile "Saved" tab in place of the
 * `useBookmarks()` → `usePostsByIds(ids)` pair, which needed two
 * sequential round trips (IDs, then N parallel post fetches). This
 * hook hits a single edge-function call that JOINs posts + author +
 * media server-side and returns fully-shaped Post[] objects.
 */
export function useBookmarkedPosts() {
  const user = useAuthStore((s) => s.user);
  const viewerId = user?.id;

  return useQuery({
    queryKey: [...bookmarkKeys.all, "posts", viewerId || "__no_user__"] as const,
    queryFn: () => bookmarksApi.getBookmarkedPosts(),
    staleTime: STALE_TIMES.bookmarks,
    gcTime: GC_TIMES.standard,
    enabled: !!viewerId,
  });
}

/**
 * INSTANT Bookmark Toggle Mutation with Optimistic Updates
 *
 * FEATURES:
 * - Instant UI feedback (optimistic updates)
 * - Automatic rollback on error
 * - Updates across all screens and profiles immediately
 * - Shows in user profiles instantly
 */
export function useToggleBookmark() {
  const queryClient = useQueryClient();
  const showToast = useUIStore((s) => s.showToast);
  const user = useAuthStore((s) => s.user);
  const viewerId = user?.id;

  return useMutation({
    mutationFn: ({
      postId,
      isBookmarked,
    }: {
      postId: string;
      isBookmarked: boolean;
    }) => bookmarksApi.toggleBookmark(postId, isBookmarked),
    // Optimistic update - instant UI feedback
    onMutate: async ({ postId, isBookmarked }) => {
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({
        queryKey: bookmarkKeys.list(viewerId),
      });

      // Snapshot the previous value
      const previousBookmarks =
        queryClient.getQueryData<string[]>(bookmarkKeys.list(viewerId)) || [];

      // Optimistically update to the new value
      queryClient.setQueryData<string[]>(
        bookmarkKeys.list(viewerId),
        (old = []) => {
          if (!isBookmarked) {
            // Add to bookmarks
            return old.includes(postId) ? old : [...old, postId];
          } else {
            // Remove from bookmarks
            return old.filter((id) => id !== postId);
          }
        },
      );

      // Update Zustand store instantly
      useBookmarkStore.getState().setBookmarked(postId, !isBookmarked);

      return { previousBookmarks, postId, isBookmarked };
    },
    onError: (_err, variables, context) => {
      // Rollback on error
      if (context?.previousBookmarks && viewerId) {
        queryClient.setQueryData(
          bookmarkKeys.list(viewerId),
          context.previousBookmarks,
        );
      }

      // Rollback Zustand store
      if (context?.postId) {
        useBookmarkStore
          .getState()
          .setBookmarked(context.postId, context.isBookmarked);
      }

      showToast(
        "error",
        "Bookmark failed",
        "Couldn't update bookmark. Check your connection.",
      );
    },
    onSuccess: (data, variables) => {
      // Ensure final state matches server response
      useBookmarkStore
        .getState()
        .setBookmarked(variables.postId, data.bookmarked);

      // No success toast — the bookmark icon flips instantly on onMutate,
      // confirming the action visually. Adding a toast on top is noise.

      // Final sync with server - invalidate to ensure consistency
      if (viewerId) {
        queryClient.invalidateQueries({
          queryKey: bookmarkKeys.list(viewerId),
        });
      }
    },
  });
}
