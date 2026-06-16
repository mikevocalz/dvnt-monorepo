/**
 * Centralized Post Like State Hook
 *
 * SINGLE SOURCE OF TRUTH for like state across all screens.
 *
 * Query Key: ['likeState', viewerId, postId]
 * Shape: { hasLiked: boolean, likes: number }
 *
 * Rules:
 * - UI reads ONLY from this hook
 * - No local useState for liked/likesCount
 * - Optimistic updates with rollback
 * - Button disabled while mutation in-flight
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { useAuthStore } from "@/lib/stores/auth-store";
import { useUIStore } from "@/lib/stores/ui-store";
import { likesApi } from "@/lib/api/likes";
import { postKeys } from "@/lib/hooks/use-posts";
import { postLikersKeys } from "@/lib/hooks/use-post-likers";
import { activityKeys } from "@/lib/hooks/use-activities-query";
import { updatePostLikeEverywhere } from "@/lib/query/patch";
import type { Post } from "@/lib/types";

interface LikeState {
  hasLiked: boolean;
  likes: number;
}

function truncateLikedTitle(value: unknown, fallback: string): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return fallback;
  if (text.length <= 96) return text;
  return `${text.slice(0, 95).trimEnd()}...`;
}

function resolveLikedPreviewImage(post: Post | undefined): string {
  if (!post) return "";
  if (post.thumbnail) return post.thumbnail;
  const firstMedia = post.media?.[0];
  if (!firstMedia) return "";
  if (firstMedia.type === "video") {
    // thumbnail field is not set by transformPost; resolveVideoUrl handles the video path
    return firstMedia.thumbnail || "";
  }
  return firstMedia.thumbnail || firstMedia.url || "";
}

/** Returns the raw video URL for a post so VideoThumbnailImage can generate a frame. */
function resolveVideoUrl(post: Post | undefined): string {
  if (!post) return "";
  const videoMedia = post.media?.find((m) => m.type === "video");
  return videoMedia?.url || "";
}

function findPostInCache(
  queryClient: ReturnType<typeof useQueryClient>,
  postId: string,
): Post | undefined {
  const detail = queryClient.getQueryData<Post>(postKeys.detail(postId));
  if (detail) return detail;

  const feed = queryClient.getQueryData<Post[]>(postKeys.feed());
  const feedMatch = feed?.find((post) => post.id === postId);
  if (feedMatch) return feedMatch;

  const infiniteFeed = queryClient.getQueryData<any>(postKeys.feedInfinite());
  for (const page of infiniteFeed?.pages || []) {
    const match = page?.data?.find((post: Post) => post.id === postId);
    if (match) return match;
  }

  const profileQueries = queryClient.getQueriesData<Post[]>({
    queryKey: ["profilePosts"],
  });
  for (const [, posts] of profileQueries) {
    const match = posts?.find((post) => post.id === postId);
    if (match) return match;
  }

  return undefined;
}

function logCacheMutation(
  action: "setQueryData" | "invalidateQueries",
  key: readonly unknown[],
) {
  if (!__DEV__) return;
  console.log(`[usePostLikeState] ${action}: ${JSON.stringify(key)}`);
}

// Query keys for like state
export const likeStateKeys = {
  all: ["likeState"] as const,
  forPost: (viewerId: string, postId: string) =>
    ["likeState", viewerId, postId] as const,
};

/**
 * Central hook for post like state
 *
 * @param postId - The post ID
 * @param initialLikesCount - Initial likes count from post data (seed value)
 * @param initialHasLiked - Initial liked state from post data (seed value)
 */
export function usePostLikeState(
  postId: string,
  initialLikesCount: number = 0,
  initialHasLiked: boolean = false,
  authorId?: string,
) {
  const queryClient = useQueryClient();
  const viewerId = useAuthStore((state) => state.user?.id) || "";
  const normalizedPostId =
    typeof postId === "string" ? postId : postId != null ? String(postId) : "";
  const likeStateQueryKey = likeStateKeys.forPost(viewerId, normalizedPostId);

  // CRITICAL: Check if we already have cached data BEFORE using initialData
  // This ensures we use server-synced values over stale props on re-mount
  const existingCache = queryClient.getQueryData<LikeState>(likeStateQueryKey);

  // Query for like state - use cached data or seed with initial values
  // NOTE: We use cache-first approach to prevent crashes from missing backend endpoints
  const { data: likeState } = useQuery<LikeState>({
    queryKey: likeStateQueryKey,
    queryFn: async () => {
      // Return cached value or initial values - no server fetch to prevent crashes
      const cached = queryClient.getQueryData<LikeState>(likeStateQueryKey);
      return cached || { hasLiked: initialHasLiked, likes: initialLikesCount };
    },
    // CRITICAL: Use existing cache if available, otherwise use initial props
    initialData: existingCache || {
      hasLiked: initialHasLiked,
      likes: initialLikesCount,
    },
    staleTime: Infinity, // Never stale - we manage updates via mutations
    gcTime: 30 * 60 * 1000, // 30 minutes
    enabled: !!viewerId && !!normalizedPostId,
  });

  // Like mutation with optimistic updates
  const likeMutation = useMutation({
    mutationKey: ["likePost", normalizedPostId],
    mutationFn: async ({ action }: { action: "like" | "unlike" }) => {
      if (action === "like") {
        return likesApi.likePost(normalizedPostId);
      } else {
        return likesApi.unlikePost(normalizedPostId);
      }
    },
    onMutate: async ({ action }) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: likeStateQueryKey });
      await queryClient.cancelQueries({ queryKey: postKeys.feedInfinite() });

      // Snapshot previous state for rollback
      const previousLikeState =
        queryClient.getQueryData<LikeState>(likeStateQueryKey);
      const prevFeedData = queryClient.getQueryData(postKeys.feedInfinite());
      const prevDetailData = queryClient.getQueryData([
        "posts",
        "detail",
        normalizedPostId,
      ]);
      const previousLikedActivity = viewerId
        ? queryClient.getQueryData(activityKeys.liked(viewerId))
        : undefined;

      // Compute optimistic values
      const newHasLiked = action === "like";
      const newLikes =
        action === "like"
          ? (previousLikeState?.likes || 0) + 1
          : Math.max((previousLikeState?.likes || 0) - 1, 0);

      // 1. Update likeState cache
      queryClient.setQueryData(likeStateQueryKey, {
        hasLiked: newHasLiked,
        likes: newLikes,
      });

      // 2. Patch ALL post caches via centralized utility
      updatePostLikeEverywhere(
        queryClient,
        normalizedPostId,
        newHasLiked,
        newLikes,
      );

      if (viewerId && action === "like") {
        const post = findPostInCache(queryClient, normalizedPostId);
        const createdAt = new Date().toISOString();
        queryClient.setQueryData(
          activityKeys.liked(viewerId),
          (old: any[] | undefined) => [
            {
              id: `optimistic-liked-post-${normalizedPostId}-${createdAt}`,
              entityType: "post",
              entityId: normalizedPostId,
              actor: {
                id: post?.author?.id || "",
                username: post?.author?.username || "user",
                avatar: post?.author?.avatar || "",
              },
              title: truncateLikedTitle(post?.caption, "A post you liked"),
              previewImage: resolveLikedPreviewImage(post),
              videoUrl: resolveVideoUrl(post),
              timeAgo: "Just now",
              createdAt,
            },
            ...(old || []),
          ],
        );
      }

      return {
        previousLikeState,
        prevFeedData,
        prevDetailData,
        previousLikedActivity,
      };
    },
    onError: (err, _variables, context) => {
      // Rollback all caches
      if (context?.previousLikeState) {
        queryClient.setQueryData(likeStateQueryKey, context.previousLikeState);
      }
      if (context?.prevFeedData) {
        queryClient.setQueryData(postKeys.feedInfinite(), context.prevFeedData);
      }
      if (context?.prevDetailData) {
        queryClient.setQueryData(
          ["posts", "detail", normalizedPostId],
          context.prevDetailData,
        );
      }
      if (viewerId && context?.previousLikedActivity !== undefined) {
        queryClient.setQueryData(
          activityKeys.liked(viewerId),
          context.previousLikedActivity,
        );
      }
      // Classify error and show user-safe toast
      const msg = err instanceof Error ? err.message : "Unknown error";
      const isNetwork = msg.includes("network") || msg.includes("fetch");
      const isAuth = msg.includes("unauthorized") || msg.includes("session");
      const toastMsg = isNetwork
        ? "Check your connection and try again"
        : isAuth
          ? "Please sign in again"
          : "Something went wrong";
      useUIStore.getState().showToast("error", "Like failed", toastMsg);
      if (__DEV__) {
        console.error(
          `[usePostLikeState] Mutation error for ${normalizedPostId}:`,
          msg,
        );
      }
    },
    onSuccess: (data) => {
      // Sync ALL caches with server-authoritative data
      const serverLiked = data.liked;
      const serverLikes = data.likes;

      // 1. Update likeState cache (this viewer)
      queryClient.setQueryData<LikeState>(likeStateQueryKey, {
        hasLiked: serverLiked,
        likes: serverLikes,
      });

      // 2. Update ALL likeState caches for this post (all viewers)
      queryClient.setQueriesData<LikeState>(
        {
          predicate: (query) => {
            const key = query.queryKey;
            return (
              Array.isArray(key) &&
              key[0] === "likeState" &&
              key[2] === normalizedPostId
            );
          },
        },
        { hasLiked: serverLiked, likes: serverLikes },
      );

      // 3. Patch ALL post caches via centralized utility
      updatePostLikeEverywhere(
        queryClient,
        normalizedPostId,
        serverLiked,
        serverLikes,
      );

      // 4. Invalidate likers list so LikesSheet shows correct data
      queryClient.invalidateQueries({
        queryKey: postLikersKeys.forPost(normalizedPostId),
      });
      if (viewerId) {
        queryClient.invalidateQueries({
          queryKey: activityKeys.liked(viewerId),
        });
      }
    },
  });

  // Like action - only if not already liked
  const like = useCallback(() => {
    if (!normalizedPostId || likeState?.hasLiked || likeMutation.isPending)
      return;
    likeMutation.mutate({ action: "like" });
  }, [likeState?.hasLiked, likeMutation, normalizedPostId]);

  // Unlike action - only if currently liked
  const unlike = useCallback(() => {
    if (!normalizedPostId || !likeState?.hasLiked || likeMutation.isPending)
      return;
    likeMutation.mutate({ action: "unlike" });
  }, [likeState?.hasLiked, likeMutation, normalizedPostId]);

  // Toggle action for convenience
  const toggle = useCallback(() => {
    if (likeMutation.isPending) return;
    if (likeState?.hasLiked) {
      unlike();
    } else {
      like();
    }
  }, [likeState?.hasLiked, likeMutation.isPending, like, unlike]);

  // CRITICAL: Prioritize cached data over initial props
  // This ensures likes sync correctly on back navigation
  const finalHasLiked =
    likeState?.hasLiked ?? existingCache?.hasLiked ?? initialHasLiked;
  const finalLikesCount =
    likeState?.likes ?? existingCache?.likes ?? initialLikesCount;

  return {
    hasLiked: finalHasLiked,
    likes: finalLikesCount,
    like,
    unlike,
    toggle,
    isPending: likeMutation.isPending,
  };
}

/**
 * Initialize like state for a post from server data
 * Call this when post data is fetched to seed the cache
 *
 * CRITICAL: Only seeds if no existing cache entry — never overwrites optimistic updates
 */
export function seedLikeState(
  queryClient: ReturnType<typeof useQueryClient>,
  viewerId: string,
  postId: string,
  hasLiked: boolean,
  likes: number,
) {
  const normalizedPostId =
    typeof postId === "string" ? postId : postId != null ? String(postId) : "";

  if (!normalizedPostId) {
    if (__DEV__) {
      console.warn("[seedLikeState] skipping seed for empty postId", postId);
    }
    return;
  }

  const key = likeStateKeys.forPost(viewerId, normalizedPostId);

  // CRITICAL: Only seed if no existing cache — never overwrite optimistic updates
  const existing = queryClient.getQueryData<LikeState>(key);
  if (existing) {
    return;
  }

  queryClient.setQueryData<LikeState>(key, { hasLiked, likes });

  if (__DEV__) {
    console.log(
      `[seedLikeState] Post ${normalizedPostId}: hasLiked=${hasLiked}, likes=${likes}`,
    );
  }
}
