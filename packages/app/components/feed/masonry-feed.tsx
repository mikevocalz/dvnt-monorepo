/**
 * MasonryFeed
 *
 * Pinterest-style 2-column masonry feed. Each cell shows:
 * - Post image/video thumbnail
 * - Bottom overlay: likes count, bookmark icon, time ago
 *
 * Event cards are interleaved every EVENT_INTERVAL posts, full-width,
 * identical to the classic feed event cards.
 *
 * Uses the same data hooks as the classic Feed — just a different view.
 */
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  ScrollView,
  RefreshControl,
  useWindowDimensions,
} from "react-native";
import { Image } from "expo-image";
import { useMemo, useCallback, memo, useEffect, useRef, useState } from "react";
import { useRouter, useFocusEffect } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { Heart, Bookmark, Play, Grid3x3 } from "lucide-react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useInfiniteFeedPosts, useSyncLikedPosts } from "@dvnt/app/lib/hooks/use-posts";
import { usePrefetchComments } from "@dvnt/app/lib/hooks/use-comments";
import { screenPrefetch } from "@dvnt/app/lib/prefetch";
import { useBookmarks, useToggleBookmark } from "@dvnt/app/lib/hooks/use-bookmarks";
import { useBookmarkStore } from "@dvnt/app/lib/stores/bookmark-store";
import { storyKeys } from "@dvnt/app/lib/hooks/use-stories";
import { useAppStore } from "@dvnt/app/lib/stores/app-store";

import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import { useBootstrapFeed } from "@dvnt/app/lib/hooks/use-bootstrap-feed";
import { FeedSkeleton } from "@dvnt/app/components/skeletons";
// StoriesBar is rendered at the HomeScreen level (app/(protected)/(tabs)/index.tsx)
// so it survives feed-mode toggles and the spicy toggle without remounting.
import { EmptyState } from "@dvnt/app/components/ui/empty-state";
import { ImageOff, WifiOff } from "lucide-react-native";
import { useConnectivityStore } from "@dvnt/app/lib/stores/connectivity-store";
import { useColorScheme } from "@dvnt/app/lib/hooks";
import { seedLikeState, usePostLikeState } from "@dvnt/app/lib/hooks/usePostLikeState";
import { navigateToPost } from "@dvnt/app/lib/routes/post-routes";
import { getVideoThumbnail } from "@dvnt/app/lib/media/getVideoThumbnail";
import { useQuery } from "@tanstack/react-query";
import { DVNTMediaBadge } from "@dvnt/app/components/media/DVNTMediaBadge";
import { DVNTGifView } from "@dvnt/app/components/media/DVNTGifView";
import { DVNTAnimatedVideoView } from "@dvnt/app/components/media/DVNTAnimatedVideoView";
import { DVNTLivePhotoView } from "@dvnt/app/components/media/DVNTLivePhotoView";
import { FeedEventCard } from "./feed-event-card";
import { shouldRenderInFeed } from "./renderable-posts";
import { useEvents } from "@dvnt/app/lib/hooks/use-events";
import type { Event } from "@dvnt/app/lib/hooks/use-events";
import type { Post } from "@dvnt/app/lib/types";
import { useFeedScrollStore } from "@dvnt/app/lib/stores/feed-scroll-store";
import * as Haptics from "expo-haptics";
import { TextPostSurface } from "@dvnt/app/components/post/TextPostSurface";
import { resolveTextPostPresentation } from "@dvnt/app/lib/posts/text-post";
import {
  extractFeedImageUrls,
  prefetchImages,
  prefetchImagesBlocking,
} from "@dvnt/app/lib/perf/image-prefetch";

// ─── Constants ──────────────────────────────────────────────────────────────

const COLUMN_GAP = 3;
const CELL_RADIUS = 12;
const NUM_COLUMNS = 2;
const VARIATION = 0.3;
const EVENT_INTERVAL = 7;

// ─── Height estimation (deterministic per post) ─────────────────────────────

function hashId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) {
    h = (h * 31 + id.charCodeAt(i)) | 0;
  }
  return Math.abs(h % 1000) / 1000;
}

function estimateRatio(post: Post): number {
  const media = post.media?.[0];
  let base = 1.2;
  if (media?.type === "video") base = 1.5;
  else if (post.hasMultipleImages) base = 1.0;
  else if (media?.type === "gif") base = 0.75;
  const offset = (hashId(post.id) * 2 - 1) * VARIATION;
  return base + offset;
}

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

// ─── Grid-shaped loading placeholder ────────────────────────────────────────

/**
 * OfflineFeedEmpty
 *
 * Premium offline surface for when the user opens the feed with no
 * cached data AND the app is confirmed offline. Replaces the generic
 * "Failed to load posts" dev-looking message.
 *
 * Reads tokens from `useColorScheme` so it tracks DVNT's palette.
 * Retry CTA fires `refetch()` — does nothing destructive even when
 * still offline (React Query knows we're offline via onlineManager
 * and pauses the retry until we're back online).
 */
function OfflineFeedEmpty({ onRetry }: { onRetry: () => void }) {
  const { colors } = useColorScheme();
  return (
    <View
      style={{
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: 32,
        paddingBottom: 120,
        gap: 16,
      }}
    >
      <View
        style={{
          width: 64,
          height: 64,
          borderRadius: 20,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: `${colors.primary}18`,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: `${colors.primary}40`,
        }}
      >
        <WifiOff size={26} color={colors.primary} />
      </View>
      <View style={{ alignItems: "center", gap: 6 }}>
        <Text
          style={{
            color: colors.foreground,
            fontSize: 18,
            fontWeight: "700",
            letterSpacing: 0.1,
          }}
        >
          You're offline
        </Text>
        <Text
          style={{
            color: colors.mutedForeground,
            fontSize: 14,
            textAlign: "center",
            lineHeight: 20,
          }}
        >
          We'll refresh the feed the moment you reconnect.
        </Text>
      </View>
      <Pressable
        onPress={onRetry}
        style={({ pressed }) => ({
          marginTop: 4,
          paddingHorizontal: 18,
          paddingVertical: 10,
          borderRadius: 12,
          backgroundColor: `${colors.foreground}10`,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: colors.border,
          opacity: pressed ? 0.7 : 1,
        })}
      >
        <Text
          style={{
            color: colors.foreground,
            fontSize: 14,
            fontWeight: "600",
            letterSpacing: 0.1,
          }}
        >
          Try again
        </Text>
      </Pressable>
    </View>
  );
}

function MasonryGridSkeleton({ columnWidth }: { columnWidth: number }) {
  const heights = [
    columnWidth * 1.4,
    columnWidth * 1.05,
    columnWidth * 1.25,
    columnWidth * 1.55,
    columnWidth * 1.1,
    columnWidth * 1.35,
  ];
  return (
    <View
      style={{
        flex: 1,
        flexDirection: "row",
        paddingHorizontal: COLUMN_GAP,
        paddingTop: COLUMN_GAP,
      }}
      pointerEvents="none"
    >
      {[0, 1].map((col) => (
        <View
          key={col}
          style={{ flex: 1, paddingHorizontal: COLUMN_GAP / 2 }}
        >
          {heights
            .filter((_, i) => i % 2 === col)
            .map((h, i) => (
              <View
                key={i}
                style={{
                  width: columnWidth,
                  height: h,
                  borderRadius: CELL_RADIUS,
                  backgroundColor: "rgba(255,255,255,0.04)",
                  marginBottom: COLUMN_GAP,
                }}
              />
            ))}
        </View>
      ))}
    </View>
  );
}

// ─── Video thumbnail cell ───────────────────────────────────────────────────

const VideoThumb = memo(function VideoThumb({
  videoUrl,
  coverUrl,
  width,
  height,
}: {
  videoUrl: string;
  coverUrl: string | null;
  width: number;
  height: number;
}) {
  const { data: generatedThumb } = useQuery({
    queryKey: ["videoThumb", videoUrl],
    queryFn: () => getVideoThumbnail(videoUrl),
    enabled: !coverUrl && Boolean(videoUrl),
    staleTime: Infinity,
    gcTime: 10 * 60 * 1000,
  });

  const uri = coverUrl ?? generatedThumb ?? null;
  if (uri) {
    return (
      <Image
        source={{ uri }}
        style={{ width, height }}
        contentFit="cover"
        cachePolicy="memory-disk"
        transition={150}
      />
    );
  }
  return (
    <View style={[styles.videoPlaceholder, { width, height }]}>
      <Play
        size={24}
        color="rgba(255,255,255,0.6)"
        fill="rgba(255,255,255,0.6)"
      />
    </View>
  );
});

// ─── Individual masonry cell ────────────────────────────────────────────────

interface MasonryCellProps {
  post: Post;
  width: number;
  height: number;
  onPress: (id: string) => void;
}

const MasonryCell = memo(function MasonryCell({
  post,
  width,
  height,
  onPress,
}: MasonryCellProps) {
  const bookmarkedPosts = useBookmarkStore((s) => s.bookmarkedPosts);
  const isBookmarked = bookmarkedPosts.includes(post.id);
  const toggleBookmark = useToggleBookmark();
  const {
    likes: likesCount,
    hasLiked,
    toggle: toggleLike,
  } = usePostLikeState(post.id, post.likes || 0, post.viewerHasLiked || false);

  const prefetchComments = usePrefetchComments();
  const queryClient = useQueryClient();
  const handlePress = useCallback(() => onPress(post.id), [post.id, onPress]);
  // Warm the post-detail + comments caches on press-in so the detail
  // screen and its comment sheet paint with data instead of a spinner.
  const handlePressIn = useCallback(() => {
    if (!post.id) return;
    screenPrefetch.postDetail(queryClient, post.id);
    prefetchComments(post.id);
  }, [post.id, prefetchComments, queryClient]);

  const handleBookmark = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    toggleBookmark.mutate({ postId: post.id, isBookmarked });
  }, [post.id, isBookmarked, toggleBookmark]);

  const handleLike = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    toggleLike();
  }, [toggleLike]);

  const media = post.media?.[0];
  const isTextPost = post.kind === "text";
  const textPostPreview = resolveTextPostPresentation(
    post.textSlides,
    post.caption,
  );
  const isVideo = media?.type === "video";
  const isCarousel = (post.media?.length || 0) > 1;
  const isGif = media?.type === "gif";
  const isAnimatedVideo = media?.type === "animated_video";
  const isLivePhoto = media?.type === "livePhoto";
  const coverUrl = isVideo
    ? post.thumbnail || media?.thumbnail || null
    : media?.thumbnail || media?.url || null;

  return (
    <Pressable
      onPress={handlePress}
      onPressIn={handlePressIn}
      style={{ marginBottom: COLUMN_GAP }}
    >
      <View style={[styles.cell, { width, height, borderRadius: CELL_RADIUS }]}>
        {isTextPost ? (
          <TextPostSurface
            text={textPostPreview.previewText}
            theme={post.textTheme}
            variant="grid"
            style={{ minHeight: height, height }}
          />
        ) : isVideo ? (
          <VideoThumb
            videoUrl={media?.url || ""}
            coverUrl={coverUrl}
            width={width}
            height={height}
          />
        ) : isGif && media?.url ? (
          // Animated GIF — route to expo-image-based player so frames
          // actually animate in the grid instead of showing a still.
          <DVNTGifView
            uri={media.url}
            width={width}
            height={height}
            contentFit="cover"
            isPlaying
          />
        ) : isAnimatedVideo && media?.url ? (
          // Short video auto-tagged as a silent looping animation (gif-like).
          // expo-image can't decode mp4, so without this branch the tile
          // falls through to <Image src=mp4Url> and renders blank.
          <DVNTAnimatedVideoView
            uri={media.url}
            width={width}
            height={height}
            contentFit="cover"
            isPlaying
          />
        ) : isLivePhoto && media?.url ? (
          // Live Photo — native player on iOS (tap-and-hold), still
          // fallback on Android.
          <DVNTLivePhotoView
            photoUri={media.url}
            videoUri={media.livePhotoVideoUrl}
            width={width}
            height={height}
            contentFit="cover"
          />
        ) : coverUrl ? (
          <Image
            source={{ uri: coverUrl }}
            style={{ width, height }}
            contentFit="cover"
            cachePolicy="memory-disk"
            transition={0}
          />
        ) : (
          <View style={[styles.emptyCell, { width, height }]}>
            <Text style={styles.emptyCellText}>No preview</Text>
          </View>
        )}

        {isVideo && (
          <View style={styles.badgeTopRight}>
            <Play size={12} color="#fff" fill="#fff" />
          </View>
        )}
        {isCarousel && !isVideo && (
          <View style={styles.badgeTopRight}>
            <Grid3x3 size={12} color="#fff" />
          </View>
        )}
        {(isGif || isLivePhoto) && (
          <View style={styles.badgeTopRight}>
            <DVNTMediaBadge kind={isGif ? "gif" : "livePhoto"} />
          </View>
        )}

        <LinearGradient
          colors={["transparent", "rgba(0,0,0,0.7)"]}
          style={styles.overlay}
        >
          <View style={styles.overlayRow}>
            <Pressable
              onPress={handleLike}
              hitSlop={8}
              style={styles.overlayAction}
            >
              <Heart
                size={14}
                color={hasLiked ? "#ef4444" : "#fff"}
                fill={hasLiked ? "#ef4444" : "transparent"}
              />
              {likesCount > 0 && (
                <Text style={styles.overlayText}>
                  {formatCount(likesCount)}
                </Text>
              )}
            </Pressable>

            <Pressable
              onPress={handleBookmark}
              hitSlop={8}
              style={styles.overlayAction}
            >
              <Bookmark
                size={14}
                color={isBookmarked ? "#3FDCFF" : "#fff"}
                fill={isBookmarked ? "#3FDCFF" : "transparent"}
              />
            </Pressable>

            <Text style={styles.overlayTime}>{post.timeAgo || ""}</Text>
          </View>
        </LinearGradient>
      </View>
    </Pressable>
  );
});

// ─── Pack posts into 2 columns (shortest-first) ────────────────────────────

interface PackedPost {
  post: Post;
  height: number;
}

function packIntoColumns(
  posts: Post[],
  columnWidth: number,
): [PackedPost[], PackedPost[]] {
  const col0: PackedPost[] = [];
  const col1: PackedPost[] = [];
  let h0 = 0;
  let h1 = 0;

  for (const post of posts) {
    const height = Math.round(columnWidth * estimateRatio(post));
    if (h0 <= h1) {
      col0.push({ post, height });
      h0 += height + COLUMN_GAP;
    } else {
      col1.push({ post, height });
      h1 += height + COLUMN_GAP;
    }
  }

  return [col0, col1];
}

// ─── Build sections: masonry chunks interleaved with event cards ────────────

type MasonrySection =
  | { type: "masonry"; key: string; posts: Post[] }
  | { type: "event"; key: string; event: Event };

function buildSections(posts: Post[], events: Event[]): MasonrySection[] {
  const sections: MasonrySection[] = [];
  let eventIdx = 0;
  let chunkStart = 0;

  for (let i = 0; i < posts.length; i++) {
    if ((i + 1) % EVENT_INTERVAL === 0 && eventIdx < events.length) {
      // Flush current chunk of posts as masonry section
      if (i >= chunkStart) {
        sections.push({
          type: "masonry",
          key: `m-${chunkStart}`,
          posts: posts.slice(chunkStart, i + 1),
        });
      }
      // Insert event card
      sections.push({
        type: "event",
        key: `e-${events[eventIdx].id}`,
        event: events[eventIdx],
      });
      eventIdx++;
      chunkStart = i + 1;
    }
  }

  // Remaining posts after last event
  if (chunkStart < posts.length) {
    sections.push({
      type: "masonry",
      key: `m-${chunkStart}`,
      posts: posts.slice(chunkStart),
    });
  }

  return sections;
}

// ─── Masonry section renderer ───────────────────────────────────────────────

const MasonrySection_ = memo(function MasonrySection_({
  posts,
  columnWidth,
  onPress,
}: {
  posts: Post[];
  columnWidth: number;
  onPress: (id: string) => void;
}) {
  const [col0, col1] = useMemo(
    () => packIntoColumns(posts, columnWidth),
    [posts, columnWidth],
  );

  return (
    <View style={styles.gridContainer}>
      <View style={{ width: columnWidth }}>
        {col0.map(({ post, height }) => (
          <MasonryCell
            key={post.id}
            post={post}
            width={columnWidth}
            height={height}
            onPress={onPress}
          />
        ))}
      </View>
      <View style={{ width: columnWidth }}>
        {col1.map(({ post, height }) => (
          <MasonryCell
            key={post.id}
            post={post}
            width={columnWidth}
            height={height}
            onPress={onPress}
          />
        ))}
      </View>
    </View>
  );
});

// ─── Main MasonryFeed ───────────────────────────────────────────────────────

export function MasonryFeed() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { width: screenWidth } = useWindowDimensions();
  const viewerId = useAuthStore((s) => s.user?.id) || "";
  const scrollRef = useRef<ScrollView>(null);
  const scrollToTopTrigger = useFeedScrollStore((s) => s.scrollToTopTrigger);

  useEffect(() => {
    if (scrollToTopTrigger > 0 && scrollRef.current) {
      scrollRef.current.scrollTo?.({ y: 0, animated: true });
    }
  }, [scrollToTopTrigger]);

  // Same data hooks as classic feed
  const bootstrapFeed = useBootstrapFeed();
  const {
    data,
    isLoading,
    error,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    refetch,
    isRefetching,
  } = useInfiniteFeedPosts({
    enabled: bootstrapFeed.shouldEnableFeedQuery,
  });

  useSyncLikedPosts();
  useBookmarks();

  const nsfwEnabled = useAppStore((s) => s.nsfwEnabled);
  const nsfwLoaded = useAppStore((s) => s.nsfwLoaded);
  const loadNsfwSetting = useAppStore((s) => s.loadNsfwSetting);

  // Drives the OfflineFeedEmpty branch below — shown only when we
  // have no cached posts AND the flap-debounced connectivity store
  // says we're confirmed offline (not just flapping).
  const isOffline = useConnectivityStore((s) => s.isOffline);

  useEffect(() => {
    loadNsfwSetting("masonry_feed_mount");
  }, [loadNsfwSetting]);

  useFocusEffect(
    useCallback(() => {
      loadNsfwSetting("masonry_feed_focus");
    }, [loadNsfwSetting]),
  );

  const allPosts = useMemo(() => {
    if (!data?.pages) return [];
    return data.pages.flatMap((page) => page.data).filter(shouldRenderInFeed);
  }, [data]);

  // Stories live at the HomeScreen level — no fetch needed here.

  // Seed like states from feed data
  useEffect(() => {
    if (!viewerId || !allPosts.length) return;
    allPosts
      .filter((post) => post?.id)
      .forEach((post) => {
        seedLikeState(
          queryClient,
          viewerId,
          post.id,
          post.viewerHasLiked === true,
          post.likes || 0,
        );
      });
  }, [allPosts, viewerId, queryClient]);

  // Strict spicy contract (mirror server-side filter to guard against any
  // cached/bootstrap rows slipping through):
  //   spicy ON  → ONLY posts where isNSFW === true
  //   spicy OFF → ONLY posts where isNSFW !== true (safe/undefined/null)
  const filteredPosts = useMemo(() => {
    if (nsfwEnabled) {
      return allPosts.filter((post) => post.isNSFW === true);
    }
    return allPosts.filter((post) => post.isNSFW !== true);
  }, [allPosts, nsfwEnabled]);

  // Interleave upcoming events in chronological (soonest-first) order
  // rather than the For-You personalization rank. Users expect "next on
  // the calendar" when scanning the home feed.
  const {
    data: forYouEvents,
    isFetched: eventsFetched,
    isError: eventsErrored,
  } = useEvents();

  const [firstPageMediaPrefetched, setFirstPageMediaPrefetched] =
    useState(false);
  useEffect(() => {
    if (allPosts.length === 0 || firstPageMediaPrefetched) return;

    let cancelled = false;

    const warmInitialMedia = async () => {
      const firstPageUrls = extractFeedImageUrls(allPosts.slice(0, 8));
      if (firstPageUrls.length > 0) {
        await prefetchImagesBlocking(firstPageUrls);
      }
      if (cancelled) return;
      setFirstPageMediaPrefetched(true);

      const remainingUrls = extractFeedImageUrls(allPosts.slice(8));
      if (remainingUrls.length > 0) {
        prefetchImages(remainingUrls);
      }
    };

    void warmInitialMedia();
    return () => {
      cancelled = true;
    };
  }, [allPosts, firstPageMediaPrefetched]);

  useEffect(() => {
    if (isRefetching) {
      setFirstPageMediaPrefetched(false);
    }
  }, [isRefetching]);

  // Build interleaved sections
  const sections = useMemo(
    () => buildSections(filteredPosts, forYouEvents ?? []),
    [filteredPosts, forYouEvents],
  );

  // Layout
  const columnWidth = Math.floor(
    (screenWidth - COLUMN_GAP * (NUM_COLUMNS + 1)) / NUM_COLUMNS,
  );

  const handlePress = useCallback(
    (id: string) => {
      navigateToPost(router, queryClient, id);
    },
    [router, queryClient],
  );

  const handleRefresh = useCallback(async () => {
    queryClient.invalidateQueries({ queryKey: storyKeys.list() });
    await refetch();
  }, [refetch, queryClient]);

  // Infinite scroll — fetch more when near bottom
  const handleScroll = useCallback(
    (e: any) => {
      const { layoutMeasurement, contentOffset, contentSize } = e.nativeEvent;
      const distanceFromBottom =
        contentSize.height - layoutMeasurement.height - contentOffset.y;
      if (distanceFromBottom < 800 && hasNextPage && !isFetchingNextPage) {
        fetchNextPage();
      }
    },
    [hasNextPage, isFetchingNextPage, fetchNextPage],
  );

  // While the grid itself is loading, render a minimal grid-shaped
  // placeholder (NOT the classic feed-post skeleton — that renders the
  // wrong shape here). Stories + events live in their own lanes and
  // must never gate the grid body.
  if (isLoading || !nsfwLoaded) {
    return <MasonryGridSkeleton columnWidth={columnWidth} />;
  }

  // Offline + no cached feed → show a deliberate offline surface
  // instead of the generic error state. Uses the flap-debounced
  // connectivity store, so we only render this after the app has
  // been confirmed offline for 1.5s (no flash on brief dips).
  if (isOffline && allPosts.length === 0) {
    return <OfflineFeedEmpty onRetry={() => refetch()} />;
  }

  if (error) {
    return (
      <View className="flex-1 items-center justify-center pb-20">
        <Text className="text-destructive">Failed to load posts</Text>
      </View>
    );
  }

  return (
    <ScrollView
      ref={scrollRef}
      showsVerticalScrollIndicator={false}
      contentContainerStyle={{ paddingBottom: 80 }}
      onScroll={handleScroll}
      scrollEventThrottle={200}
      refreshControl={
        <RefreshControl
          refreshing={isRefetching}
          onRefresh={handleRefresh}
          tintColor="#fff"
        />
      }
    >
      {/* StoriesBar lifted to HomeScreen (app/(protected)/(tabs)/index.tsx)
          so it stays mounted across feed-mode toggles and the spicy toggle.
          Thin divider restores the separator that used to sit above the grid. */}
      <View
        style={{
          height: 8,
          borderTopWidth: 1,
          borderTopColor: "rgba(255,255,255,0.06)",
        }}
      />

      {filteredPosts.length === 0 ? (
        <EmptyState
          icon={ImageOff}
          title="No Posts Yet"
          description="When you or people you follow share posts, they'll appear here"
        />
      ) : (
        <>
          {sections.map((section) => {
            if (section.type === "event") {
              return <FeedEventCard key={section.key} event={section.event} />;
            }
            return (
              <MasonrySection_
                key={section.key}
                posts={section.posts}
                columnWidth={columnWidth}
                onPress={handlePress}
              />
            );
          })}
        </>
      )}

      {isFetchingNextPage && (
        <View style={styles.loadMore}>
          <Text style={styles.loadMoreText}>Loading...</Text>
        </View>
      )}
    </ScrollView>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  gridContainer: {
    flexDirection: "row",
    paddingHorizontal: COLUMN_GAP,
    gap: COLUMN_GAP,
  },
  cell: {
    overflow: "hidden",
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  emptyCell: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  emptyCellText: {
    color: "rgba(255,255,255,0.3)",
    fontSize: 12,
  },
  videoPlaceholder: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.6)",
  },
  badgeTopRight: {
    position: "absolute",
    top: 8,
    right: 8,
    backgroundColor: "rgba(0,0,0,0.5)",
    borderRadius: 10,
    padding: 4,
  },
  overlay: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 10,
    paddingBottom: 10,
    paddingTop: 24,
    borderBottomLeftRadius: CELL_RADIUS,
    borderBottomRightRadius: CELL_RADIUS,
  },
  overlayRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  overlayAction: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
  },
  overlayText: {
    color: "#fff",
    fontSize: 11,
    fontWeight: "600",
  },
  overlayTime: {
    color: "rgba(255,255,255,0.6)",
    fontSize: 10,
    marginLeft: "auto",
  },
  loadMore: {
    paddingVertical: 20,
    alignItems: "center",
  },
  loadMoreText: {
    color: "rgba(255,255,255,0.5)",
    fontSize: 12,
  },
});
