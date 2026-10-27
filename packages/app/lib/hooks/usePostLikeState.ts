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

import { useQuery, useMutation, useIsMutating, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import { useUIStore } from "@dvnt/app/lib/stores/ui-store";
import { likesApi } from "@dvnt/app/lib/api/likes";
import { postKeys, activityKeys } from "@dvnt/app/lib/query-keys";
import { markPostLikeMutation } from "@dvnt/app/lib/posts/like-state-sync";
import { updatePostLikeEverywhere } from "@dvnt/app/lib/query/patch";
import type { Post } from "@dvnt/app/lib/types";
import { postLikersKeys, likeStateKeys } from "@dvnt/app/lib/query-keys";
import { useAppStore } from "@dvnt/app/lib/stores/app-store";
export { likeStateKeys };

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

  const infiniteFeed = queryClient.getQueryData<any>(postKeys.feedInfinite(useAppStore.getState().nsfwEnabled));
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

// Acquired synchronously before mutate(), so rapid clicks and separate mounted
// feed/detail hooks cannot send duplicate toggles before React renders pending.
const pendingLikes = new WeakMap<QueryClient, Set<string>>();
interface LikeOperation {
  action: "like" | "unlike";
  isCurrent: () => boolean;
  finish: () => void;
}

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

  const mutationKey = ["likePost", normalizedPostId, viewerId];
  const isPending = useIsMutating({ mutationKey }) > 0;

  const likeMutation = useMutation({
    mutationKey,
    // toggle-like is not idempotent. Never inherit a global automatic retry.
    retry: false,
    mutationFn: async (operation: LikeOperation) => {
      if (!operation.isCurrent()) throw new Error("Session changed while liking post");
      return operation.action === "like"
        ? likesApi.likePost(normalizedPostId, operation.isCurrent)
        : likesApi.unlikePost(normalizedPostId, operation.isCurrent);
    },
    onMutate: async (operation: LikeOperation) => {
      await Promise.all([
        queryClient.cancelQueries({ queryKey: likeStateQueryKey }),
        queryClient.cancelQueries({ queryKey: postKeys.feedInfiniteAll() }),
        queryClient.cancelQueries({ queryKey: postKeys.feed(), exact: true }),
        queryClient.cancelQueries({ queryKey: postKeys.detail(normalizedPostId) }),
        queryClient.cancelQueries({ queryKey: ["profilePosts"] }),
        queryClient.cancelQueries({ queryKey: ["likedPosts", viewerId] }),
      ]);
      if (!operation.isCurrent()) throw new Error("Session changed while liking post");
      const previousLikeState = queryClient.getQueryData<LikeState>(likeStateQueryKey) || {
        hasLiked: initialHasLiked, likes: initialLikesCount,
      };
      const newHasLiked = operation.action === "like";
      const newLikes = Math.max(0, previousLikeState.likes +
        (newHasLiked === previousLikeState.hasLiked ? 0 : newHasLiked ? 1 : -1));
      queryClient.setQueryData(likeStateQueryKey, { hasLiked: newHasLiked, likes: newLikes });
      updatePostLikeEverywhere(queryClient, normalizedPostId, newHasLiked, newLikes);

      const optimisticActivityId = `optimistic-liked-post-${normalizedPostId}-${Date.now()}`;
      if (operation.action === "like") {
        const post = findPostInCache(queryClient, normalizedPostId);
        queryClient.setQueryData(activityKeys.liked(viewerId), (old: any[] | undefined) => [
          {
            id: optimisticActivityId,
            entityType: "post",
            entityId: normalizedPostId,
            actor: { id: post?.author?.id || "", username: post?.author?.username || "user", avatar: post?.author?.avatar || "" },
            title: truncateLikedTitle(post?.caption, "A post you liked"),
            previewImage: resolveLikedPreviewImage(post),
            videoUrl: resolveVideoUrl(post),
            timeAgo: "Just now",
            createdAt: new Date().toISOString(),
          },
          ...(old || []),
        ]);
      }
      return { previousLikeState, optimisticActivityId };
    },
    onError: (err, operation, context) => {
      if (!operation.isCurrent()) return;
      if (context?.previousLikeState) {
        const previous = context.previousLikeState;
        queryClient.setQueryData(likeStateQueryKey, previous);
        // Roll back just this post's like fields, not snapshots of whole feeds
        // that could erase a newer comment or another post's successful like.
        updatePostLikeEverywhere(queryClient, normalizedPostId, previous.hasLiked, previous.likes);
        queryClient.setQueryData(activityKeys.liked(viewerId), (old: any[] | undefined) =>
          old?.filter((item) => item.id !== context.optimisticActivityId));
      }
      const msg = err instanceof Error ? err.message.toLowerCase() : "unknown error";
      const toastMsg = msg.includes("network") || msg.includes("fetch")
        ? "Check your connection and try again"
        : msg.includes("unauthorized") || msg.includes("session")
          ? "Please sign in again" : "Something went wrong";
      useUIStore.getState().showToast("error", "Like failed", toastMsg);
    },
    onSuccess: (data, operation) => {
      if (!operation.isCurrent()) return;
      // hasLiked belongs to this viewer. Never copy it into other accounts.
      queryClient.setQueryData<LikeState>(likeStateQueryKey, { hasLiked: data.liked, likes: data.likes });
      updatePostLikeEverywhere(queryClient, normalizedPostId, data.liked, data.likes);
      queryClient.invalidateQueries({ queryKey: postLikersKeys.forPost(normalizedPostId) });
      queryClient.invalidateQueries({ queryKey: activityKeys.liked(viewerId) });
    },
    onSettled: (_data, _error, operation) => operation.finish(),
  });

  const requestLike = useCallback((requested?: "like" | "unlike") => {
    if (!normalizedPostId || !viewerId || useAuthStore.getState().user?.id !== viewerId) return;
    let pending = pendingLikes.get(queryClient);
    if (!pending) { pending = new Set(); pendingLikes.set(queryClient, pending); }
    const lockKey = JSON.stringify([viewerId, normalizedPostId]);
    if (pending.has(lockKey) || queryClient.isMutating({ mutationKey: ["likePost", normalizedPostId, viewerId] })) return;
    // Read current cache, not a closure from the last render.
    const current = queryClient.getQueryData<LikeState>(likeStateQueryKey) || likeState;
    const action = requested || (current?.hasLiked ? "unlike" : "like");
    if ((action === "like") === current?.hasLiked) return;
    pending.add(lockKey);
    const locks = pending;
    markPostLikeMutation(queryClient, normalizedPostId);
    let identityChanged = false;
    const unsubscribe = useAuthStore.subscribe((state) => {
      if (state.user?.id !== viewerId) identityChanged = true;
    });
    const operation: LikeOperation = {
      action,
      isCurrent: () => !identityChanged && useAuthStore.getState().user?.id === viewerId,
      finish: () => { unsubscribe(); locks.delete(lockKey); markPostLikeMutation(queryClient, normalizedPostId); },
    };
    likeMutation.mutate(operation);
  }, [queryClient, viewerId, normalizedPostId, likeStateQueryKey, likeState, likeMutation]);
  const like = useCallback(() => requestLike("like"), [requestLike]);
  const unlike = useCallback(() => requestLike("unlike"), [requestLike]);
  const toggle = useCallback(() => requestLike(), [requestLike]);

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
    isPending,
  };
}

/**
 * Initialize like state for a post from server data
 * Call this when post data is fetched to seed the cache
 *
 * Server snapshots may refresh the cache, but never overwrite pending mutations
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

  // Never clobber an optimistic update that is still settling — but only skip
  // while a like mutation for THIS post is genuinely in flight. The old check
  // ("does a cache entry exist?") meant any stale entry won forever: this query
  // is staleTime: Infinity with a queryFn that never hits the network, so once
  // seeded there was no path back to server truth. On web, where the cache was
  // also restored from localStorage, that froze hearts and counts across
  // sessions.
  const isMutating =
    queryClient.isMutating({ mutationKey: ["likePost", normalizedPostId] }) > 0;
  if (isMutating) {
    return;
  }

  queryClient.setQueryData<LikeState>(key, { hasLiked, likes });

  if (__DEV__) {
    console.log(
      `[seedLikeState] Post ${normalizedPostId}: hasLiked=${hasLiked}, likes=${likes}`,
    );
  }
}
