/**
 * Centralized Screen Prefetch — eliminates waterfalls across ALL navigation.
 *
 * Call these BEFORE router.push() so data is in TanStack cache when the screen mounts.
 * Each function is fire-and-forget (returns void, never throws).
 *
 * Usage:
 *   import { screenPrefetch } from "@/lib/prefetch";
 *   screenPrefetch.postDetail(queryClient, postId);
 *   router.push(`/(protected)/post/${postId}`);
 */

import type { QueryClient } from "@tanstack/react-query";
import { postsApi } from "@/lib/api/posts";
import { usersApi } from "@/lib/api/users";
import { commentsApi as commentsApiClient } from "@/lib/api/comments";
import { eventsApi as eventsApiClient } from "@/lib/api/events";
import { postKeys } from "@/lib/hooks/use-posts";
import { commentKeys } from "@/lib/hooks/use-comments";
import { eventKeys } from "@/lib/hooks/use-events";
import { STALE_TIMES } from "@/lib/perf/stale-time-config";

export const screenPrefetch = {
  /** Post detail screen — post data + comments */
  postDetail(qc: QueryClient, postId: string) {
    if (!postId) return;
    qc.prefetchQuery({
      queryKey: postKeys.detail(postId),
      queryFn: () => postsApi.getPostById(postId),
      staleTime: STALE_TIMES.postDetail,
    });
    qc.prefetchQuery({
      queryKey: [...commentKeys.byPost(postId), 50],
      queryFn: () => commentsApiClient.getComments(postId, 50),
      staleTime: STALE_TIMES.comments,
    });
  },

  /** Profile screen — user data + profile posts */
  profile(qc: QueryClient, username: string) {
    if (!username) return;
    qc.prefetchQuery({
      queryKey: ["users", "username", username],
      queryFn: () => usersApi.getProfileByUsername(username),
    });
    qc.prefetchQuery({
      queryKey: postKeys.profilePosts(username),
      queryFn: () => postsApi.getProfilePosts(username),
    });
  },

  /** Followers list */
  followers(qc: QueryClient, userId: string) {
    if (!userId) return;
    qc.prefetchInfiniteQuery({
      queryKey: ["users", "followers", userId],
      queryFn: async () => {
        const result = await usersApi.getFollowers(userId, 1);
        return {
          users: result.docs || [],
          nextPage: result.hasNextPage ? 2 : null,
        };
      },
      initialPageParam: 1,
    });
  },

  /** Following list */
  following(qc: QueryClient, userId: string) {
    if (!userId) return;
    qc.prefetchInfiniteQuery({
      queryKey: ["users", "following", userId],
      queryFn: async () => {
        const result = await usersApi.getFollowing(userId, 1);
        return {
          users: result.docs || [],
          nextPage: result.hasNextPage ? 2 : null,
        };
      },
      initialPageParam: 1,
    });
  },

  /** Event detail screen */
  eventDetail(qc: QueryClient, eventId: string) {
    if (!eventId) return;
    qc.prefetchQuery({
      queryKey: eventKeys.detail(eventId),
      queryFn: () => eventsApiClient.getEventById(eventId),
      staleTime: 5 * 60 * 1000,
    });
  },

  /** Comments screen (also called from feed eager prefetch) */
  comments(qc: QueryClient, postId: string) {
    if (!postId) return;
    qc.prefetchQuery({
      queryKey: [...commentKeys.byPost(postId), 50],
      queryFn: () => commentsApiClient.getComments(postId, 50),
      staleTime: STALE_TIMES.comments,
    });
  },

  /** Event comments screen */
  eventComments(qc: QueryClient, eventId: string) {
    if (!eventId) return;
    qc.prefetchQuery({
      queryKey: ["event-comments", "event", eventId],
      queryFn: () => eventsApiClient.getEventComments(eventId, 100),
      staleTime: STALE_TIMES.comments,
    });
  },
};
