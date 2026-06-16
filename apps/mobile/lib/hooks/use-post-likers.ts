/**
 * usePostLikers — TanStack Query hook for fetching users who liked a post.
 *
 * Query Key: ['postLikers', postId]
 * Only fetches when enabled (sheet is open).
 *
 * Prefetch: Call prefetchPostLikers before opening LikesSheet to avoid waterfall.
 */

import {
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { useCallback } from "react";
import { likesApi, type PostLiker } from "@/lib/api/likes";
import { likeStateKeys } from "@/lib/hooks/usePostLikeState";
import { useAuthStore } from "@/lib/stores/auth-store";
import { assertLikesConsistent } from "@/lib/invariants/likesConsistency";

export const postLikersKeys = {
  all: ["postLikers"] as const,
  forPost: (postId: string) => ["postLikers", postId] as const,
};

export function usePostLikers(postId: string | undefined, enabled: boolean) {
  const queryClient = useQueryClient();
  const viewerId = useAuthStore((s) => s.user?.id) || "";

  return useQuery<PostLiker[]>({
    queryKey: postLikersKeys.forPost(postId || ""),
    queryFn: async () => {
      const result = await likesApi.getPostLikers(postId!);

      // Sync authoritative likesCount from DB into likeState cache
      // This fixes count/sheet mismatch when likes_count drifted
      if (viewerId && postId && result.likesCount != null) {
        const likeKey = likeStateKeys.forPost(viewerId, postId);
        const cachedState = queryClient.getQueryData<{ likes: number }>(
          likeKey,
        );

        // DEV: Assert card count == sheet count (same authority)
        if (cachedState) {
          assertLikesConsistent(postId, cachedState.likes, result.likesCount);
        }

        queryClient.setQueryData(likeKey, (old: any) => {
          if (!old) return old;
          return { ...old, likes: result.likesCount };
        });
      }

      return result.likers;
    },
    enabled: !!postId && enabled,
    staleTime: 0, // Always fresh when sheet opens — count must match list
    gcTime: 5 * 60 * 1000,
  });
}

/** Prefetch likers before opening sheet — eliminates waterfall. Fire-and-forget. */
export function prefetchPostLikers(
  queryClient: QueryClient,
  postId: string,
): void {
  if (!postId) return;
  queryClient.prefetchQuery({
    queryKey: postLikersKeys.forPost(postId),
    queryFn: () => likesApi.getPostLikers(postId),
  });
}

/** Hook that returns prefetch fn for use in Pressable onPress */
export function usePrefetchPostLikers() {
  const queryClient = useQueryClient();
  return useCallback(
    (postId: string) => prefetchPostLikers(queryClient, postId),
    [queryClient],
  );
}
