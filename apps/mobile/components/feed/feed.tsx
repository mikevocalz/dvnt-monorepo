import {
  View,
  Text,
  Platform,
  RefreshControl,
  StyleSheet,
  Animated as RNAnimated,
} from "react-native";
import { LegendList } from "@/components/list";
import type { LegendListRef } from "@/components/list";
import { FeedPost } from "./feed-post";
import { FeedEventCard } from "./feed-event-card";
import { shouldRenderInFeed } from "./renderable-posts";
import { useInfiniteFeedPosts, useSyncLikedPosts } from "@/lib/hooks/use-posts";
import { useFeedRealtime } from "@/lib/hooks/use-feed-realtime";
import { useEvents } from "@/lib/hooks/use-events";
import type { Event } from "@/lib/hooks/use-events";
import { FeedSkeleton } from "@/components/skeletons";
import { useAppStore } from "@/lib/stores/app-store";
import {
  useMemo,
  useEffect,
  useRef,
  useCallback,
  memo,
  type ReactNode,
} from "react";
import { useFeedPostUIStore } from "@/lib/stores/feed-post-store";
// StoriesBar is rendered at the HomeScreen level (app/(protected)/(tabs)/index.tsx)
// so it survives feed-mode toggles and the spicy toggle without remounting.
import { EmptyState } from "@/components/ui/empty-state";
import { ImageOff } from "lucide-react-native";
import type { Post } from "@/lib/types";
import { useBookmarks } from "@/lib/hooks/use-bookmarks";
import { useQueryClient } from "@tanstack/react-query";
import { useAuthStore } from "@/lib/stores/auth-store";
import { seedLikeState } from "@/lib/hooks/usePostLikeState";
import { prefetchComments } from "@/lib/hooks/use-comments";
import { useFeedScrollStore } from "@/lib/stores/feed-scroll-store";
import { useBootstrapFeed } from "@/lib/hooks/use-bootstrap-feed";
import { storyKeys } from "@/lib/hooks/use-stories";
import { useScreenTrace } from "@/lib/perf/screen-trace";
import {
  prefetchImages,
  prefetchImagesBlocking,
  extractFeedImageUrls,
} from "@/lib/perf/image-prefetch";
import {
  useLikesSheet,
  fireLikesTap,
} from "@/src/features/likes/LikesSheetController";
import { PostActionSheet } from "@/components/post-action-sheet";
import { useReportSheetStore } from "@/lib/stores/report-sheet-store";
import { ShareToInboxSheet } from "@/components/share-to-inbox-sheet";
import { resolveTextPostPresentation } from "@/lib/posts/text-post";
import { useRouter } from "expo-router";
import { Alert } from "react-native";
import { useDeletePost } from "@/lib/hooks/use-posts";
import { sharePost } from "@/lib/utils/sharing";
import { useCreateStory } from "@/lib/hooks/use-stories";
import { useUIStore } from "@/lib/stores/ui-store";
import { useFocusEffect } from "expo-router";
import type { PublicGateReason } from "@/lib/access/public-gates";

type FeedPostItem = { _type: "post"; data: Post };
type FeedEventItem = { _type: "event"; data: Event };
type FeedItem = FeedPostItem | FeedEventItem;

const EVENT_INTERVAL = 7;

const REFRESH_COLORS = ["#34A2DF", "#8A40CF", "#FF5BFC"];

const FALLBACK_AUTHOR = {
  id: undefined,
  username: "unknown",
  avatar: "",
} as const;
const EMPTY_MEDIA: import("@/lib/types").PostMediaItem[] = [];

const AnimatedFeedPost = memo(function AnimatedFeedPost({
  item,
  onShowLikes,
  guestMode,
  onGuestGate,
}: {
  item: Post;
  index: number;
  onShowLikes?: (postId: string) => void;
  guestMode?: boolean;
  onGuestGate?: (reason: PublicGateReason) => void;
}) {
  return (
    <View style={{ paddingVertical: 12 }}>
      <FeedPost
        id={item.id || ""}
        author={item.author || FALLBACK_AUTHOR}
        media={item.media || EMPTY_MEDIA}
        kind={item.kind}
        textTheme={item.textTheme}
        caption={item.caption || ""}
        textSlides={item.textSlides}
        textSlideCount={item.textSlideCount}
        likes={item.likes || 0}
        viewerHasLiked={item.viewerHasLiked || false}
        comments={item.comments || 0}
        timeAgo={item.timeAgo || ""}
        location={item.location}
        isNSFW={item.isNSFW}
        onShowLikes={onShowLikes}
        guestMode={guestMode}
        onGuestGate={onGuestGate}
      />
    </View>
  );
});

function LoadMoreIndicator() {
  return (
    <View style={styles.loadMoreContainer}>
      <View style={styles.loadMoreDots}>
        <View
          style={[styles.loadMoreDot, { backgroundColor: REFRESH_COLORS[0] }]}
        />
        <View
          style={[styles.loadMoreDot, { backgroundColor: REFRESH_COLORS[1] }]}
        />
        <View
          style={[styles.loadMoreDot, { backgroundColor: REFRESH_COLORS[2] }]}
        />
      </View>
    </View>
  );
}

function GradientRefreshIndicator({ refreshing }: { refreshing: boolean }) {
  const dot1Anim = useRef(new RNAnimated.Value(0)).current;
  const dot2Anim = useRef(new RNAnimated.Value(0)).current;
  const dot3Anim = useRef(new RNAnimated.Value(0)).current;
  const animationRef = useRef<RNAnimated.CompositeAnimation | null>(null);

  useEffect(() => {
    if (refreshing) {
      animationRef.current = RNAnimated.loop(
        RNAnimated.sequence([
          RNAnimated.timing(dot1Anim, {
            toValue: 1,
            duration: 250,
            useNativeDriver: true,
          }),
          RNAnimated.timing(dot2Anim, {
            toValue: 1,
            duration: 250,
            useNativeDriver: true,
          }),
          RNAnimated.timing(dot3Anim, {
            toValue: 1,
            duration: 250,
            useNativeDriver: true,
          }),
          RNAnimated.timing(dot1Anim, {
            toValue: 0,
            duration: 250,
            useNativeDriver: true,
          }),
          RNAnimated.timing(dot2Anim, {
            toValue: 0,
            duration: 250,
            useNativeDriver: true,
          }),
          RNAnimated.timing(dot3Anim, {
            toValue: 0,
            duration: 250,
            useNativeDriver: true,
          }),
        ]),
      );
      animationRef.current.start();
    } else {
      animationRef.current?.stop();
      dot1Anim.setValue(0);
      dot2Anim.setValue(0);
      dot3Anim.setValue(0);
    }
    return () => {
      animationRef.current?.stop();
    };
  }, [refreshing, dot1Anim, dot2Anim, dot3Anim]);

  const dot1Scale = dot1Anim.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.4],
  });
  const dot2Scale = dot2Anim.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.4],
  });
  const dot3Scale = dot3Anim.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.4],
  });

  return (
    <View style={styles.gradientRefreshContainer}>
      <RNAnimated.View
        style={[
          styles.gradientDot,
          {
            backgroundColor: REFRESH_COLORS[0],
            transform: [{ scale: dot1Scale }],
          },
        ]}
      />
      <RNAnimated.View
        style={[
          styles.gradientDot,
          {
            backgroundColor: REFRESH_COLORS[1],
            transform: [{ scale: dot2Scale }],
          },
        ]}
      />
      <RNAnimated.View
        style={[
          styles.gradientDot,
          {
            backgroundColor: REFRESH_COLORS[2],
            transform: [{ scale: dot3Scale }],
          },
        ]}
      />
    </View>
  );
}

export function Feed({
  guestMode = false,
  headerContent = null,
  onGuestGate,
}: {
  guestMode?: boolean;
  headerContent?: ReactNode;
  onGuestGate?: (reason: PublicGateReason) => void;
}) {
  const router = useRouter();
  const showToast = useUIStore((s) => s.showToast);
  const deletePostMutation = useDeletePost();
  const createStoryMutation = useCreateStory();

  // Likes sheet — centralized controller at app root, no per-screen instance
  // FeedPost now calls useLikesSheet() directly; handleShowLikes kept as fallback for onShowLikes prop
  const { open: openLikesSheet } = useLikesSheet();
  const handleShowLikes = useCallback(
    (postId: string) => {
      fireLikesTap(postId, openLikesSheet);
    },
    [openLikesSheet],
  );

  // ── Lifted sheets (rendered outside FlatList to avoid cell clipping) ──
  const actionSheetPostId = useFeedPostUIStore((s) => s.actionSheetPostId);
  const shareSheetPostId = useFeedPostUIStore((s) => s.shareSheetPostId);
  const setActionSheetPostId = useFeedPostUIStore(
    (s) => s.setActionSheetPostId,
  );
  const setShareSheetPostId = useFeedPostUIStore((s) => s.setShareSheetPostId);

  // Perf: Bootstrap hydrates the TanStack cache BEFORE individual queries run.
  // When perf_bootstrap_feed flag is ON, a single edge function call populates
  // the feed cache, so useInfiniteFeedPosts returns data instantly from cache.
  const bootstrapFeed = useBootstrapFeed();
  const trace = useScreenTrace("Feed");

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

  // Stories live at the HomeScreen level — they do NOT gate the feed.
  // Any stale stories state refreshes via queryClient.invalidateQueries
  // on pull-to-refresh below (storyKeys.list()).

  // CRITICAL: Get queryClient and viewerId for seeding likeState cache
  const queryClient = useQueryClient();
  const viewerId = useAuthStore((state) => state.user?.id) || "";

  // Sync liked posts from server to Zustand store on mount
  useSyncLikedPosts();
  useBookmarks();
  // Live feed: new posts/deletes stream in without pull-to-refresh.
  useFeedRealtime();

  const nsfwEnabled = useAppStore((s) => s.nsfwEnabled);
  const effectiveNsfwEnabled = !guestMode && nsfwEnabled;
  const nsfwLoaded = useAppStore((s) => s.nsfwLoaded);
  const loadNsfwSetting = useAppStore((s) => s.loadNsfwSetting);
  const { setActivePostId } = useFeedPostUIStore();
  const prevNsfwEnabled = useRef(nsfwEnabled);
  const listRef = useRef<LegendListRef>(null);
  const scrollToTopTrigger = useFeedScrollStore((s) => s.scrollToTopTrigger);

  useEffect(() => {
    if (scrollToTopTrigger > 0 && listRef.current) {
      listRef.current.scrollToOffset?.({ offset: 0, animated: true });
    }
  }, [scrollToTopTrigger]);

  useEffect(() => {
    loadNsfwSetting("feed_mount");
  }, [loadNsfwSetting]);

  useFocusEffect(
    useCallback(() => {
      loadNsfwSetting("feed_focus");
    }, [loadNsfwSetting]),
  );

  useEffect(() => {
    prevNsfwEnabled.current = effectiveNsfwEnabled;
  }, [effectiveNsfwEnabled]);

  const allPosts = useMemo(() => {
    if (!data?.pages) return [];
    return data.pages.flatMap((page) => page.data).filter(shouldRenderInFeed);
  }, [data]);

  const firstPageImagesPrefetched = useFeedPostUIStore(
    (s) => s.firstPageImagesPrefetched,
  );
  const setFirstPageImagesPrefetched = useFeedPostUIStore(
    (s) => s.setFirstPageImagesPrefetched,
  );
  const resetImagePrefetch = useFeedPostUIStore((s) => s.resetImagePrefetch);

  // Perf: Prefetch first page images BEFORE showing content (prevents waterfall)
  useEffect(() => {
    if (allPosts.length === 0 || firstPageImagesPrefetched) return;

    let cancelled = false;

    const warmInitialFeed = async () => {
      const firstPagePosts = allPosts.slice(0, 8);
      const urls = extractFeedImageUrls(firstPagePosts);

      if (urls.length > 0) {
        await prefetchImagesBlocking(urls);
      }

      if (cancelled) return;

      const offScreenPosts = allPosts.slice(8);
      if (offScreenPosts.length > 0) {
        const offScreenUrls = extractFeedImageUrls(offScreenPosts);
        prefetchImages(offScreenUrls);
      }

      setFirstPageImagesPrefetched(true);
      if (trace.elapsed() < 50) trace.markCacheHit();
      trace.markUsable();

      allPosts.slice(0, 5).forEach((post) => {
        if (post?.id) prefetchComments(queryClient, post.id);
      });
    };

    void warmInitialFeed();

    return () => {
      cancelled = true;
    };
  }, [
    allPosts,
    firstPageImagesPrefetched,
    queryClient,
    setFirstPageImagesPrefetched,
    trace,
  ]);

  // CRITICAL: Seed like states from feed data
  // The custom /api/posts/feed endpoint now returns isLiked and likesCount per post
  // No need for separate API calls - just seed the cache from the feed data
  useEffect(() => {
    if (!viewerId || !allPosts.length) return;

    if (__DEV__) {
      console.log(
        `[Feed] Seeding like states for ${allPosts.length} posts from feed data`,
      );
    }

    // Seed the cache with like states from the feed response
    allPosts
      .filter((post) => post?.id)
      .forEach((post) => {
        // viewerHasLiked comes from isLiked in the feed response
        const hasLiked = post.viewerHasLiked === true;
        const likesCount = post.likes || 0;

        seedLikeState(queryClient, viewerId, post.id, hasLiked, likesCount);
      });

    if (__DEV__) {
      const withLikes = allPosts.filter((p) => (p.likes || 0) > 0);
      const withViewerLiked = allPosts.filter((p) => p.viewerHasLiked);
      console.log(
        `[Feed] Seeded ${allPosts.length} like states: ${withLikes.length} have likes, ${withViewerLiked.length} viewer liked`,
      );
    }
  }, [allPosts, viewerId, queryClient]);

  // Strict spicy contract (mirror server-side filter to guard against any
  // cached/bootstrap rows slipping through):
  //   spicy ON  → ONLY posts where isNSFW === true
  //   spicy OFF → ONLY posts where isNSFW !== true (safe/undefined/null)
  const filteredPosts = useMemo(() => {
    if (effectiveNsfwEnabled) {
      return allPosts.filter((post) => post.isNSFW === true);
    }
    return allPosts.filter((post) => post.isNSFW !== true);
  }, [allPosts, effectiveNsfwEnabled]);

  // Fetch events for inline feed cards
  // Interleave upcoming events in chronological (soonest-first) order
  // rather than For-You personalization rank.
  const {
    data: forYouEvents,
    isFetched: eventsFetched,
    isError: eventsErrored,
  } = useEvents();

  // Interleave event cards every EVENT_INTERVAL posts
  const feedItems: FeedItem[] = useMemo(() => {
    const events = forYouEvents ?? [];
    const items: FeedItem[] = [];
    let eventIdx = 0;
    for (let i = 0; i < filteredPosts.length; i++) {
      items.push({ _type: "post", data: filteredPosts[i] });
      if ((i + 1) % EVENT_INTERVAL === 0 && eventIdx < events.length) {
        items.push({ _type: "event", data: events[eventIdx] });
        eventIdx++;
      }
    }
    return items;
  }, [filteredPosts, forYouEvents]);

  const renderItem = useCallback(
    ({ item, index }: { item: FeedItem; index: number }) => {
      if (item._type === "event") {
        return (
          <FeedEventCard
            event={item.data}
            guestMode={guestMode}
            onRequireAuth={onGuestGate}
          />
        );
      }
      return (
        <AnimatedFeedPost
          item={item.data}
          index={index}
          onShowLikes={handleShowLikes}
          guestMode={guestMode}
          onGuestGate={onGuestGate}
        />
      );
    },
    [guestMode, handleShowLikes, onGuestGate],
  );

  const keyExtractor = useCallback((item: FeedItem, index: number) => {
    if (item._type === "event") return `feed-event-${item.data.id}`;
    return item.data?.id || `post-${index}`;
  }, []);

  const handleEndReached = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const handleRefresh = useCallback(async () => {
    // Refetch feed posts AND stories on pull-to-refresh
    queryClient.invalidateQueries({ queryKey: storyKeys.list() });
    await refetch();
  }, [refetch, queryClient]);

  const renderFooter = useCallback(() => {
    if (!isFetchingNextPage) return null;
    return <LoadMoreIndicator />;
  }, [isFetchingNextPage]);

  const viewabilityConfig = useRef({
    itemVisiblePercentThreshold: 70,
    minimumViewTime: 50,
  }).current;

  // Track if we've set the initial active post for this feed load
  const hasSetInitialPost = useRef(false);

  // Set first post as active when feed loads (for video autoplay)
  useEffect(() => {
    // Reset the flag when posts change (e.g., after refresh)
    if (filteredPosts.length === 0) {
      hasSetInitialPost.current = false;
      return;
    }

    // Only set initial post once per feed load
    if (!hasSetInitialPost.current && filteredPosts.length > 0) {
      hasSetInitialPost.current = true;
      // Always set the first post as active for autoplay
      setActivePostId(filteredPosts[0].id);
    }
  }, [filteredPosts, setActivePostId]);

  // Reset the flag when component unmounts or data is refetched
  useEffect(() => {
    if (isRefetching) {
      hasSetInitialPost.current = false;
      resetImagePrefetch();
    }
  }, [isRefetching, resetImagePrefetch]);

  // Track which posts we've already prefetched comments for
  const prefetchedComments = useRef(new Set<string>()).current;

  const onViewableItemsChanged = useRef(
    ({
      viewableItems,
    }: {
      viewableItems: { item: FeedItem; isViewable: boolean }[];
    }) => {
      if (viewableItems.length > 0) {
        // Find first viewable post (skip event cards for active post tracking)
        const firstPost = viewableItems.find(
          (v) => v.isViewable && v.item._type === "post",
        );
        if (firstPost && firstPost.item._type === "post") {
          setActivePostId(firstPost.item.data.id);
        }
        // Eager prefetch comments for newly visible posts
        viewableItems.forEach(({ item }) => {
          if (
            item._type === "post" &&
            item.data?.id &&
            !prefetchedComments.has(item.data.id)
          ) {
            prefetchedComments.add(item.data.id);
            prefetchComments(queryClient, item.data.id);
          }
        });
      } else {
        setActivePostId(null);
      }
    },
  ).current;

  const ListEmpty = useCallback(
    () => (
      <EmptyState
        icon={ImageOff}
        title="No Posts Yet"
        description="When you or people you follow share posts, they'll appear here"
      />
    ),
    [],
  );

  // Only show empty state if we're definitely not loading and have no data
  const shouldShowEmptyState =
    !isLoading && nsfwLoaded && allPosts.length === 0 && !error;

  const actionPost = useMemo(
    () =>
      actionSheetPostId
        ? allPosts.find((p) => p.id === actionSheetPostId)
        : undefined,
    [actionSheetPostId, allPosts],
  );

  const sharePost_ = useMemo(
    () =>
      shareSheetPostId
        ? allPosts.find((p) => p.id === shareSheetPostId)
        : undefined,
    [shareSheetPostId, allPosts],
  );

  const currentUsername = useAuthStore((s) => s.user?.username);
  const actionIsOwner = actionPost?.author?.username === currentUsername;

  const handleActionEdit = useCallback(() => {
    if (actionSheetPostId)
      router.push(`/(protected)/edit-post/${actionSheetPostId}`);
    setActionSheetPostId(null);
  }, [actionSheetPostId, router, setActionSheetPostId]);

  const handleActionDelete = useCallback(() => {
    if (!actionSheetPostId) return;
    Alert.alert("Delete Post", "Are you sure you want to delete this post?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => {
          deletePostMutation.mutate(actionSheetPostId, {
            // No success toast — the post disappears from the feed, which IS
            // the confirmation. Keep the error toast so a failed delete is
            // surfaced explicitly.
            onError: () =>
              showToast(
                "error",
                "Delete failed",
                "Couldn't delete post. Try again.",
              ),
          });
          setActionSheetPostId(null);
        },
      },
    ]);
  }, [actionSheetPostId, deletePostMutation, showToast, setActionSheetPostId]);

  const handleActionShare = useCallback(async () => {
    if (actionPost) {
      try {
        const sharedCaption =
          actionPost.kind === "text"
            ? resolveTextPostPresentation(
                actionPost.textSlides,
                actionPost.caption,
              ).previewText
            : actionPost.caption;
        await sharePost(actionPost.id, sharedCaption);
      } catch {}
    }
    setActionSheetPostId(null);
  }, [actionPost, setActionSheetPostId]);

  const handleActionShareToStory = useCallback(async () => {
    const media = actionPost?.media?.[0];
    if (!media?.url) {
      showToast("error", "Error", "This post has no media to share");
      return;
    }
    try {
      await createStoryMutation.mutateAsync({
        items: [{ type: media.type || "image", url: media.url }],
      });
      showToast("success", "Added to your story", "");
    } catch {
      showToast(
        "error",
        "Share failed",
        "Couldn't add this post to your story.",
      );
    }
    setActionSheetPostId(null);
  }, [actionPost, createStoryMutation, showToast, setActionSheetPostId]);

  // Show the feed skeleton only while the feed itself is loading. Stories
  // and events live in their own lanes (StoriesBar at the HomeScreen level,
  // events fetched on the events tab) — gating the whole feed on them was
  // why the home tab felt like it was loading forever after cold start.
  const feedResolved = !isLoading;
  const isActuallyLoading = !feedResolved || !nsfwLoaded;

  if (__DEV__) {
    useEffect(() => {
      console.log("[Feed] Loading state changed:", {
        isLoading,
        nsfwLoaded,
        hasData: !!data,
        allPostsLength: allPosts.length,
        isActuallyLoading,
      });
    }, [isLoading, nsfwLoaded, data, allPosts.length, isActuallyLoading]);
  }

  if (isActuallyLoading) {
    return <FeedSkeleton />;
  }

  if (error) {
    return (
      <View className="flex-1 bg-background items-center justify-center pb-20">
        <Text className="text-destructive">Failed to load posts</Text>
      </View>
    );
  }

  return (
    <>
      <LegendList
        ref={listRef}
        data={feedItems}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={
          feedItems.length === 0
            ? { flex: 1, paddingBottom: 80 }
            : { paddingBottom: 80 }
        }
        showsVerticalScrollIndicator={false}
        recycleItems
        estimatedItemSize={500}
        onEndReached={handleEndReached}
        onEndReachedThreshold={0.5}
        ListHeaderComponent={() =>
          guestMode ? (
            <>{headerContent}</>
          ) : (
            // StoriesBar lifted to HomeScreen (app/(protected)/(tabs)/index.tsx)
            // so it stays mounted across feed-mode toggles and the spicy toggle.
            // Restore the thin divider that used to sit above the first post.
            <View
              style={{
                height: 8,
                borderTopWidth: 1,
                borderTopColor: "rgba(255,255,255,0.06)",
              }}
            />
          )
        }
        ListFooterComponent={renderFooter}
        ListEmptyComponent={shouldShowEmptyState ? ListEmpty : undefined}
        viewabilityConfig={viewabilityConfig}
        onViewableItemsChanged={onViewableItemsChanged}
        refreshing={isRefetching}
        onRefresh={handleRefresh}
      />

      {/* Sheets lifted from FeedPost — rendered outside FlatList so they aren't clipped by cell boundaries */}
      {!guestMode && (
        <PostActionSheet
          visible={!!actionSheetPostId}
          onClose={() => setActionSheetPostId(null)}
          isOwner={actionIsOwner}
          onEdit={handleActionEdit}
          onDelete={handleActionDelete}
          onShareToStory={handleActionShareToStory}
          onShare={handleActionShare}
          onReport={() => {
            // App Store Guideline 1.2 — surfaces the global ReportSheet
            // when a non-owner taps Report Post in the action sheet.
            if (!actionSheetPostId) return;
            useReportSheetStore.getState().openReportSheet({
              entityType: "post",
              entityId: String(actionSheetPostId),
              label: actionPost?.author?.username
                ? `@${actionPost.author.username}`
                : undefined,
            });
          }}
        />
      )}

      {!guestMode && (
        <ShareToInboxSheet
          visible={!!shareSheetPostId}
          onClose={() => setShareSheetPostId(null)}
          post={
            sharePost_
              ? {
                  id: sharePost_.id,
                  authorUsername: sharePost_.author?.username || "",
                  authorAvatar: sharePost_.author?.avatar || "",
                  caption:
                    sharePost_.kind === "text"
                      ? resolveTextPostPresentation(
                          sharePost_.textSlides,
                          sharePost_.caption,
                        ).previewText
                      : sharePost_.caption,
                  mediaUrl: sharePost_.media?.[0]?.url,
                  mediaType: sharePost_.media?.[0]?.type,
                }
              : null
          }
        />
      )}
    </>
  );
}

const styles = StyleSheet.create({
  loadMoreContainer: {
    paddingVertical: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  loadMoreDots: {
    flexDirection: "row",
    gap: 8,
  },
  loadMoreDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  gradientRefreshContainer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    height: 40,
  },
  gradientDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
});
