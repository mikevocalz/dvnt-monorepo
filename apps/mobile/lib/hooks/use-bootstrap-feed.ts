/**
 * Bootstrap Feed Hook
 *
 * When `perf_bootstrap_feed` flag is ON, fetches all feed above-the-fold
 * data in a single request and hydrates the TanStack Query cache.
 *
 * When the flag is OFF, returns null and the feed falls back to
 * individual queries (useInfiniteFeedPosts, useSyncLikedPosts, etc.)
 *
 * Cache hydration strategy:
 * 1. Call bootstrap-feed edge function (1 request)
 * 2. Seed the infinite feed query cache with posts
 * 3. Seed the unread counts cache with viewer context
 * 4. Seed like state cache per post
 * 5. Return stories data for the StoriesBar
 */

import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuthStore } from "@/lib/stores/auth-store";
import { useAppStore } from "@/lib/stores/app-store";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { bootstrapApi, type BootstrapFeedResponse } from "@/lib/api/bootstrap";
import { postKeys } from "@/lib/hooks/use-posts";
import { messageKeys } from "@/lib/hooks/use-messages";
import { seedLikeState } from "@/lib/hooks/usePostLikeState";
import { useScreenTrace } from "@/lib/perf/screen-trace";
import { useUnreadCountsStore } from "@/lib/stores/unread-counts-store";
import {
  normalizeTextPostTheme,
  resolveTextPostPresentation,
} from "@/lib/posts/text-post";

/**
 * Hydrate TanStack Query cache from bootstrap response.
 * This replaces 5+ individual queries with cache writes from a single response.
 */
function hydrateFromBootstrap(
  queryClient: ReturnType<typeof useQueryClient>,
  userId: string,
  data: BootstrapFeedResponse,
) {
  // 1. Seed the infinite feed query cache
  // Transform bootstrap posts to match the existing feed page format
  const feedPage = {
    data: data.posts.map((p) => {
      const media = p.media || [];
      const hasTextContent =
        typeof p.caption === "string" && p.caption.trim().length > 0;
      const kind =
        p.kind === "text" || (media.length === 0 && hasTextContent)
          ? ("text" as const)
          : ("media" as const);
      const primaryMedia = media[0];
      const textPresentation =
        kind === "text"
          ? resolveTextPostPresentation(
              p.textSlides,
              p.caption,
            )
          : { textSlides: [], caption: "", previewText: "" };

      return {
        id: p.id,
        kind,
        textTheme:
          kind === "text" ? normalizeTextPostTheme(p.textTheme) : undefined,
        caption: kind === "text" ? textPresentation.caption : p.caption,
        textSlides: kind === "text" ? textPresentation.textSlides : undefined,
        textSlideCount:
          kind === "text" ? textPresentation.textSlides.length : undefined,
        createdAt: p.createdAt,
        isNSFW: p.isNSFW,
        location: p.location,
        likes: p.likes,
        comments: p.commentsCount,
        viewerHasLiked: p.viewerHasLiked,
        author: {
          id: p.author.id,
          username: p.author.username,
          avatar: p.author.avatar,
          verified: p.author.verified,
        },
        media: media.map((m) => ({
          type: m.type,
          url: m.url,
          ...(m.mimeType ? { mimeType: m.mimeType } : {}),
          ...(m.livePhotoVideoUrl ? { livePhotoVideoUrl: m.livePhotoVideoUrl } : {}),
        })),
        thumbnail:
          kind === "media" && primaryMedia?.type !== "video"
            ? primaryMedia?.url
            : undefined,
        type:
          kind === "media" ? (primaryMedia?.type as any) || "image" : undefined,
        hasMultipleImages: kind === "media" && media.length > 1,
        timeAgo: "", // Computed client-side from createdAt
      };
    }),
    nextCursor: data.nextCursor,
    hasMore: data.hasMore,
  };

  queryClient.setQueryData(postKeys.feedInfinite(), {
    pages: [feedPage],
    pageParams: [0],
  });

  // 2. Seed unread counts only when backend confirms the source is authoritative.
  if (data.viewer?.unreadMessagesAuthoritative) {
    queryClient.setQueryData(messageKeys.unreadCount(userId), {
      inbox: data.viewer.unreadMessages,
      spam: 0,
    });
    const store = useUnreadCountsStore.getState();
    store.setMessagesUnread(data.viewer.unreadMessages);
    store.setSpamUnread(0);
  }

  // 3. Seed like state per post
  data.posts.forEach((post) => {
    seedLikeState(
      queryClient,
      userId,
      post.id,
      post.viewerHasLiked,
      post.likes,
    );
  });

  console.log(
    `[BootstrapFeed] Hydrated cache: ${data.posts.length} posts, ` +
      `${data.stories.length} stories, ` +
      `unread=${data.viewer.unreadMessages} authoritative=${data.viewer.unreadMessagesAuthoritative === true}`,
  );
}

function getCachedFeedItems(
  queryClient: ReturnType<typeof useQueryClient>,
): unknown[] {
  const existingFeed = queryClient.getQueryData(postKeys.feedInfinite()) as any;
  if (!Array.isArray(existingFeed?.pages)) return [];
  return existingFeed.pages.flatMap((page: any) => page?.data || []);
}

/**
 * Hook: use bootstrap feed if the feature flag is enabled.
 *
 * Returns bootstrap status to gate dependent queries.
 * Prevents double-loading by ensuring bootstrap completes BEFORE
 * useInfiniteFeedPosts runs.
 */
export function useBootstrapFeed() {
  const queryClient = useQueryClient();
  const userId = useAuthStore((s) => s.user?.id) || "";
  const nsfwEnabled = useAppStore((s) => s.nsfwEnabled);
  const hasRun = useRef(false);
  const isBootstrapping = useRef(false);
  const [bootstrapState, setBootstrapState] = useState<{
    key: string;
    status: "idle" | "bootstrapping" | "ready";
  }>({
    key: "",
    status: "idle",
  });
  const trace = useScreenTrace("Feed");

  const enabled = isFeatureEnabled("perf_bootstrap_feed");
  const canBootstrap = enabled && !!userId;
  const bootstrapKey = canBootstrap ? `${userId}:${nsfwEnabled}` : "disabled";
  const hasCachedFeed = getCachedFeedItems(queryClient).length > 0;
  const status =
    bootstrapState.key === bootstrapKey ? bootstrapState.status : "idle";

  useEffect(() => {
    if (bootstrapState.key !== bootstrapKey) {
      hasRun.current = false;
      isBootstrapping.current = false;
      setBootstrapState({
        key: bootstrapKey,
        status: canBootstrap ? "idle" : "ready",
      });
      return;
    }

    if (!canBootstrap) {
      return;
    }

    if (hasRun.current || isBootstrapping.current) return;

    // Check if we already have fresh feed data from MMKV cache
    const existingFeed = queryClient.getQueryData(postKeys.feedInfinite()) as any;
    const cachedItems = getCachedFeedItems(queryClient);

    if (
      existingFeed &&
      Array.isArray(existingFeed.pages) &&
      cachedItems.length > 0
    ) {
      trace.markCacheHit();
      trace.markUsable();
      console.log("[BootstrapFeed] Cache hit — skipping bootstrap call");
      hasRun.current = true;
      setBootstrapState({ key: bootstrapKey, status: "ready" });
      return;
    }

    if (
      existingFeed &&
      Array.isArray(existingFeed.pages) &&
      cachedItems.length === 0
    ) {
      queryClient.removeQueries({
        queryKey: postKeys.feedInfinite(),
        exact: true,
      });
    }

    // Mark as bootstrapping to prevent duplicate calls
    hasRun.current = true;
    isBootstrapping.current = true;
    setBootstrapState({ key: bootstrapKey, status: "bootstrapping" });

    // Fire bootstrap request
    console.log("[BootstrapFeed] No cached data, running bootstrap");
    bootstrapApi
      .feed({ userId, includeNSFW: nsfwEnabled })
      .then((data) => {
        isBootstrapping.current = false;

        if (!data) {
          console.warn(
            "[BootstrapFeed] Bootstrap failed — falling back to individual queries",
          );
          setBootstrapState({ key: bootstrapKey, status: "ready" });
          return;
        }

        hydrateFromBootstrap(queryClient, userId, data);
        trace.markUsable();
        setBootstrapState({ key: bootstrapKey, status: "ready" });
      })
      .catch((error) => {
        isBootstrapping.current = false;
        setBootstrapState({ key: bootstrapKey, status: "ready" });
        console.error("[BootstrapFeed] Bootstrap error:", error);
      });
  }, [
    bootstrapKey,
    bootstrapState.key,
    canBootstrap,
    nsfwEnabled,
    queryClient,
    trace,
    userId,
  ]);

  const shouldEnableFeedQuery =
    !canBootstrap || hasCachedFeed || status === "ready";

  return {
    enabled,
    isBootstrapping:
      canBootstrap && !hasCachedFeed && status === "bootstrapping",
    shouldEnableFeedQuery,
  };
}
