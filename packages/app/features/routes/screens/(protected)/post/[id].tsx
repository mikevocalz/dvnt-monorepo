import {
  View,
  Text,
  ScrollView,
  Pressable,
  Dimensions,
  Modal,
  StatusBar,
  ActivityIndicator,
} from "react-native";
import { useLocalSearchParams, useRouter, useFocusEffect } from "expo-router";
import React, {
  useCallback,
  useMemo,
  useState,
  useEffect,
  useRef,
  memo,
} from "react";
import * as Haptics from "expo-haptics";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  ArrowLeft,
  Heart,
  MessageCircle,
  Send,
  Bookmark,
  MoreHorizontal,
  Volume2,
  VolumeX,
  Play,
  Maximize2,
  Minimize2,
} from "lucide-react-native";
import { useColorScheme } from "@dvnt/app/lib/hooks";
import { PostDetailSkeleton } from "@dvnt/app/components/skeletons";
import { usePost, useDeletePost } from "@dvnt/app/lib/hooks/use-posts";
import { useComments } from "@dvnt/app/lib/hooks/use-comments";
import { CommentLikeButton } from "@dvnt/app/components/comments/threaded-comment";
import { usePostLikeState } from "@dvnt/app/lib/hooks/usePostLikeState";
import { useVideoPlayerStore } from "@dvnt/app/lib/stores/video-player-store";
// STABILIZED: Bookmark state comes from server via useBookmarks hook only
import { useToggleBookmark, useBookmarks } from "@dvnt/app/lib/hooks/use-bookmarks";
import { sharePost } from "@dvnt/app/lib/utils/sharing";
import { VideoView, useVideoPlayer } from "expo-video";
import { Image } from "expo-image";
import {
  useVideoLifecycle,
  safePlay,
  safePause,
  safeSeek,
  safeGetCurrentTime,
  safeGetDuration,
  logVideoHealth,
} from "@dvnt/app/lib/video-lifecycle";
import { DVNTSeekBar } from "@dvnt/app/components/media/DVNTSeekBar";
import { DVNTMediaRenderer } from "@dvnt/app/components/media/DVNTMediaRenderer";
import {
  DVNTLiquidGlass,
  DVNTLiquidGlassIconButton,
} from "@dvnt/app/components/media/DVNTLiquidGlass";
import { HashtagText } from "@dvnt/app/components/ui/hashtag-text";
import { PostActionSheet } from "@dvnt/app/components/post-action-sheet";
import { useReportSheetStore } from "@dvnt/app/lib/stores/report-sheet-store";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import { useUIStore } from "@dvnt/app/lib/stores/ui-store";
import { useBookmarkStore } from "@dvnt/app/lib/stores/bookmark-store";
import { usePostDetailScreenStore } from "@dvnt/app/lib/stores/post-detail-screen-store";
import { normalizeRouteParams } from "@dvnt/app/lib/navigation/route-params";
import {
  loopDetection,
  useRenderLoopDetector,
} from "@dvnt/app/lib/diagnostics/loop-detection";
import { postsApi } from "@dvnt/app/lib/api/posts";
import { Avatar } from "@dvnt/app/components/ui/avatar";
import { ErrorBoundary } from "@dvnt/app/components/error-boundary";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { screenPrefetch } from "@dvnt/app/lib/prefetch";
import { formatLikeCount } from "@dvnt/app/lib/utils/format-count";
import { Alert } from "react-native";
import { TagOverlayViewer } from "@dvnt/app/components/tags/TagOverlayViewer";
// Galeria's native gestureRecognizer doesn't fire on iOS 26 — the
// MediaLightbox drop-in matches Galeria's API (urls + .Image namespace)
// using @gorhom/bottom-sheet, no native dependency. Revert when upstream
// @nandorojo/galeria ships an iOS 26 fix.
import { MediaLightbox as Galeria } from "@dvnt/app/components/media/MediaLightbox";
import { usePostTags } from "@dvnt/app/lib/hooks/use-post-tags";
import { usePostTagsUIStore } from "@dvnt/app/lib/stores/post-tags-store";
import { TextPostSurface } from "@dvnt/app/components/post/TextPostSurface";
import {
  useSharedValue,
  withSpring,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import {
  useLikesSheet,
  fireLikesTap,
} from "@dvnt/app/src/features/likes/LikesSheetController";
import { normalizePost } from "@dvnt/app/lib/normalization/safe-entity";
import { validatePostParams } from "@dvnt/app/lib/validation/post-params";
import { resolveRenderableTextPostPresentation } from "@dvnt/app/lib/posts/text-post";
import { TranslateButton } from "@dvnt/app/components/ui/translate-button";
import { useContentTranslation } from "@dvnt/app/lib/stores/translation-store";
import { useTranslation } from "react-i18next";
import { shouldShowTranslateButton } from "@dvnt/app/lib/utils/language-detection";

const { width: SCREEN_WIDTH } = Dimensions.get("window");
// CRITICAL: Match FeedItem's 4:5 aspect ratio for consistent display
const PORTRAIT_HEIGHT = Math.round(SCREEN_WIDTH * (5 / 4));

function resolveDetailTextSlides(
  postId: string,
  fallbackText: string | undefined,
  slides: import("@dvnt/app/lib/types").TextPostSlide[] | undefined,
) {
  const normalizedSlides = Array.isArray(slides)
    ? [...slides]
        .filter((slide) => slide?.content?.trim?.().length > 0)
        .sort((a, b) => a.order - b.order)
    : [];

  if (normalizedSlides.length > 0) {
    return normalizedSlides;
  }

  if (fallbackText?.trim()) {
    return [{ id: `${postId}-slide-0`, order: 0, content: fallbackText }];
  }

  return [];
}

function resolveCommentSheetRoute(
  postId: string,
  commentId: string | undefined,
  comments: import("@dvnt/app/lib/types").Comment[],
) {
  if (!commentId) {
    return `/(protected)/comments/${postId}`;
  }

  for (const comment of comments) {
    if (comment.id === commentId) {
      return `/(protected)/comments/${postId}?commentId=${commentId}`;
    }

    const matchingReply = (comment.replies || []).find(
      (reply) => reply.id === commentId,
    );
    if (matchingReply) {
      return `/(protected)/comments/replies/${comment.id}?postId=${postId}&focusCommentId=${commentId}`;
    }
  }

  return `/(protected)/comments/${postId}?commentId=${commentId}`;
}

/**
 * Mini error boundary for media section — if video or Galeria crashes,
 * the rest of the screen (header, caption, comments) still works.
 */
class SafeMediaWrapper extends React.Component<
  { children: React.ReactNode; width: number; height: number },
  { crashed: boolean; error: string }
> {
  state = { crashed: false, error: "" };
  static getDerivedStateFromError(e: Error) {
    return { crashed: true, error: e?.message || "Media failed to load" };
  }
  componentDidCatch(e: Error) {
    console.error("[PostDetail:SafeMedia]", e?.message);
  }
  render() {
    if (this.state.crashed) {
      return (
        <View
          style={{
            width: this.props.width,
            height: this.props.height,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: "#1a1a1a",
          }}
        >
          <Text style={{ color: "#999", fontSize: 14 }}>Media unavailable</Text>
          <Text style={{ color: "#666", fontSize: 11, marginTop: 4 }}>
            {this.state.error}
          </Text>
        </View>
      );
    }
    return this.props.children;
  }
}

function PostDetailActionBar({
  variant = "glass",
  isLiked,
  likeCount,
  commentCount,
  isBookmarked,
  isLikePending,
  timeAgo,
  onLike,
  onComments,
  onShare,
  onBookmark,
}: {
  variant?: "glass" | "inline";
  isLiked: boolean;
  likeCount: number;
  commentCount: number;
  isBookmarked: boolean;
  isLikePending: boolean;
  timeAgo: string;
  onLike: () => void;
  onComments: () => void;
  onShare: () => void;
  onBookmark: () => void;
}) {
  const timestamp = (
    <Text
      style={{
        fontSize: variant === "glass" ? 12 : 11,
        color:
          variant === "glass"
            ? "rgba(255,255,255,0.6)"
            : "rgba(226,232,240,0.62)",
        fontWeight: "700",
        textTransform: "uppercase",
        ...(variant === "glass"
          ? {
              textShadowColor: "rgba(0,0,0,0.8)",
              textShadowOffset: { width: 0, height: 1 },
              textShadowRadius: 3,
            }
          : null),
      }}
    >
      {timeAgo}
    </Text>
  );

  const controls = (
    <>
      <Pressable
        onPress={onLike}
        disabled={isLikePending}
        hitSlop={8}
        style={{ flexDirection: "row", alignItems: "center", gap: 6 }}
      >
        <Heart
          size={variant === "glass" ? 22 : 20}
          color={isLiked ? "#FF5BFC" : "#fff"}
          fill={isLiked ? "#FF5BFC" : "none"}
        />
        <Text
          style={{
            color: "#fff",
            fontSize: variant === "glass" ? 14 : 13,
            fontWeight: "700",
            ...(variant === "glass"
              ? {
                  textShadowColor: "rgba(0,0,0,0.8)",
                  textShadowOffset: { width: 0, height: 1 },
                  textShadowRadius: 3,
                }
              : null),
          }}
        >
          {formatLikeCount(likeCount)}
        </Text>
      </Pressable>

      {variant === "glass" && (
        <View
          style={{
            width: 1,
            height: 18,
            backgroundColor: "rgba(255,255,255,0.2)",
          }}
        />
      )}

      <Pressable
        hitSlop={8}
        onPress={onComments}
        style={{ flexDirection: "row", alignItems: "center", gap: 6 }}
      >
        <MessageCircle size={variant === "glass" ? 22 : 20} color="#fff" />
        <Text
          style={{
            color: "#fff",
            fontSize: variant === "glass" ? 14 : 13,
            fontWeight: "700",
            ...(variant === "glass"
              ? {
                  textShadowColor: "rgba(0,0,0,0.8)",
                  textShadowOffset: { width: 0, height: 1 },
                  textShadowRadius: 3,
                }
              : null),
          }}
        >
          {commentCount}
        </Text>
      </Pressable>

      {variant === "glass" && (
        <View
          style={{
            width: 1,
            height: 18,
            backgroundColor: "rgba(255,255,255,0.2)",
          }}
        />
      )}

      <Pressable hitSlop={8} onPress={onShare}>
        <Send size={variant === "glass" ? 22 : 20} color="#fff" />
      </Pressable>

      {variant === "glass" && (
        <View
          style={{
            width: 1,
            height: 18,
            backgroundColor: "rgba(255,255,255,0.2)",
          }}
        />
      )}

      <Pressable hitSlop={8} onPress={onBookmark}>
        <Bookmark
          size={variant === "glass" ? 22 : 20}
          color={isBookmarked ? "#3FDCFF" : "#fff"}
          fill={isBookmarked ? "#3FDCFF" : "none"}
        />
      </Pressable>
    </>
  );

  if (variant === "inline") {
    return (
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          marginTop: 16,
          paddingTop: 12,
          borderTopWidth: 1,
          borderTopColor: "rgba(255,255,255,0.08)",
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 18 }}>
          {controls}
        </View>
        {timestamp}
      </View>
    );
  }

  return (
    <DVNTLiquidGlass paddingH={12} paddingV={9} radius={14}>
      {controls}
      <View
        style={{
          width: 1,
          height: 18,
          backgroundColor: "rgba(255,255,255,0.2)",
        }}
      />
      {timestamp}
    </DVNTLiquidGlass>
  );
}

/**
 * Isolated video player — only mounts for actual video posts.
 * Keeps useVideoPlayer out of the main component to prevent
 * creating (and tearing down) a native player for every image post.
 */
function PostVideoPlayer({ postId, url }: { postId: string; url?: string }) {
  const { isMountedRef, isSafeToOperate } = useVideoLifecycle(
    "PostDetail",
    postId,
  );
  const {
    currentTime,
    duration,
    isMuted,
    isPlaying,
    isFullscreen,
    setCurrentTime,
    setDuration,
    setIsMuted,
    setIsPlaying,
    setIsFullscreen,
    reset,
  } = useVideoPlayerStore();
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const videoUrl = useMemo(() => {
    if (
      url &&
      typeof url === "string" &&
      (url.startsWith("http://") || url.startsWith("https://"))
    ) {
      return url;
    }
    return "";
  }, [url]);

  const player = useVideoPlayer(videoUrl || null, (p) => {
    if (p && videoUrl && isMountedRef.current) {
      try {
        p.loop = false;
        p.muted = false;
        // Duck background audio while the post video plays instead of
        // preempting it — the user gets to hear the post sound over a
        // lowered Spotify, not a silent one.
        p.audioMixingMode = "duckOthers";
        logVideoHealth("PostDetail", "player configured", {
          postId,
          videoUrl: videoUrl.slice(0, 50),
        });
      } catch (error) {
        logVideoHealth("PostDetail", "config error", { error: String(error) });
      }
    }
  });

  // Poll video time
  useEffect(() => {
    if (!player || !videoUrl) return;
    pollRef.current = setInterval(() => {
      if (!isMountedRef.current) return;
      const t = safeGetCurrentTime(player, isMountedRef, "PostDetail");
      const d = safeGetDuration(player, isMountedRef, "PostDetail");
      if (t !== null) setCurrentTime(t);
      if (d !== null && d > 0) setDuration(d);
    }, 250);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [player, videoUrl, isMountedRef]);

  useFocusEffect(
    useCallback(() => {
      if (player && videoUrl && isSafeToOperate()) {
        safePlay(player, isMountedRef, "PostDetail");
        setIsPlaying(true);
      }
      return () => {
        if (!player || !videoUrl) return;
        if (isSafeToOperate()) {
          safePause(player, isMountedRef, "PostDetail");
          setIsPlaying(false);
        }
      };
    }, [player, videoUrl, isSafeToOperate, isMountedRef]),
  );

  const handleSeek = useCallback(
    (time: number) => safeSeek(player, isMountedRef, time, "PostDetail"),
    [player, isMountedRef],
  );

  const togglePlayPause = useCallback(() => {
    if (!player || !isMountedRef.current) return;
    if (isPlaying) {
      safePause(player, isMountedRef, "PostDetail");
      setIsPlaying(false);
    } else {
      safePlay(player, isMountedRef, "PostDetail");
      setIsPlaying(true);
    }
  }, [player, isMountedRef, isPlaying]);

  const toggleMute = useCallback(() => {
    if (!player || !isMountedRef.current) return;
    try {
      player.muted = !isMuted;
      setIsMuted(!isMuted);
    } catch {}
  }, [player, isMountedRef, isMuted]);

  const handleFullscreenToggle = useCallback(() => {
    setIsFullscreen(!isFullscreen);
  }, [isFullscreen, setIsFullscreen]);

  // CRITICAL: NO early returns - always render same structure to maintain hook count
  const hasVideo = !!videoUrl;

  return (
    <View style={{ width: "100%", height: "100%" }}>
      {!hasVideo ? (
        <View
          style={{
            width: "100%",
            height: "100%",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Text className="text-muted-foreground">Video unavailable</Text>
        </View>
      ) : (
        <Pressable onPress={togglePlayPause} style={{ flex: 1 }}>
          <VideoView
            player={player}
            style={{ width: "100%", height: "100%" }}
            contentFit="cover"
            nativeControls={false}
          />
          {/* Play overlay when paused */}
          {!isPlaying && (
            <View
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <View
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: 28,
                  backgroundColor: "rgba(0,0,0,0.5)",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Play size={28} color="#fff" fill="#fff" />
              </View>
            </View>
          )}
        </Pressable>
      )}

      {/* Mute toggle - only show for videos */}
      <Pressable
        onPress={toggleMute}
        style={{
          display: hasVideo ? "flex" : "none",
          position: "absolute",
          top: 12,
          right: 12,
          zIndex: 50,
        }}
        hitSlop={12}
      >
        <View
          style={{
            width: 34,
            height: 34,
            borderRadius: 17,
            backgroundColor: "rgba(0,0,0,0.5)",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {isMuted ? (
            <VolumeX size={16} color="#fff" />
          ) : (
            <Volume2 size={16} color="#fff" />
          )}
        </View>
      </Pressable>

      {/* Expand button - only show for videos */}
      <Pressable
        onPress={handleFullscreenToggle}
        style={{
          display: hasVideo ? "flex" : "none",
          position: "absolute",
          bottom: 12,
          right: 12,
          zIndex: 50,
        }}
        hitSlop={12}
      >
        <DVNTLiquidGlassIconButton size={36}>
          <Maximize2 size={17} color="#fff" />
        </DVNTLiquidGlassIconButton>
      </Pressable>

      {/* Seek bar - only show for videos */}
      <View style={{ display: hasVideo ? "flex" : "none" }}>
        <DVNTSeekBar
          currentTime={currentTime}
          duration={duration}
          onSeek={handleSeek}
          onSeekEnd={() => {
            if (isPlaying) safePlay(player, isMountedRef, "PostDetail");
          }}
          barWidth={SCREEN_WIDTH - 32}
        />
      </View>

      {/* Fullscreen modal - only show for videos */}
      <Modal
        visible={hasVideo && isFullscreen}
        animationType="fade"
        supportedOrientations={["portrait", "landscape"]}
        statusBarTranslucent
        onRequestClose={handleFullscreenToggle}
      >
        <StatusBar hidden />
        <View style={{ flex: 1, backgroundColor: "#000" }}>
          <Pressable onPress={togglePlayPause} style={{ flex: 1 }}>
            <VideoView
              player={player}
              style={{ flex: 1 }}
              contentFit="contain"
              nativeControls={false}
            />
            {!isPlaying && (
              <View
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <View
                  style={{
                    width: 56,
                    height: 56,
                    borderRadius: 28,
                    backgroundColor: "rgba(0,0,0,0.5)",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Play size={28} color="#fff" fill="#fff" />
                </View>
              </View>
            )}
          </Pressable>
          {/* Seek bar — 20px from bottom */}
          <View
            style={{
              position: "absolute",
              bottom: 16,
              left: 0,
              right: 0,
              height: 28,
            }}
          >
            <DVNTSeekBar
              currentTime={currentTime}
              duration={duration}
              onSeek={handleSeek}
              onSeekEnd={() => {
                if (isPlaying) safePlay(player, isMountedRef, "PostDetail");
              }}
            />
          </View>
          {/* Minimize — bottom right, above seek bar */}
          <Pressable
            onPress={handleFullscreenToggle}
            style={{ position: "absolute", bottom: 56, right: 20 }}
            hitSlop={16}
          >
            <DVNTLiquidGlassIconButton size={42}>
              <Minimize2 size={20} color="#fff" />
            </DVNTLiquidGlassIconButton>
          </Pressable>
          {/* Mute */}
          <Pressable
            onPress={toggleMute}
            style={{ position: "absolute", top: 52, left: 20 }}
            hitSlop={16}
          >
            <DVNTLiquidGlassIconButton size={42}>
              {isMuted ? (
                <VolumeX size={20} color="#fff" />
              ) : (
                <Volume2 size={20} color="#fff" />
              )}
            </DVNTLiquidGlassIconButton>
          </Pressable>
        </View>
      </Modal>
    </View>
  );
}

// ─── Slide-aware leaf components ────────────────────────────────────────────
// These subscribe to `currentSlide` via selector so slide changes only
// re-render themselves, never the parent screen. This is the fix for GIF
// flicker in multi-media posts: before this split, every swipe re-rendered
// PostDetailScreenContent, which rebuilt the entire carousel subtree and
// restarted every GIF's native decoder.

function useCurrentSlide() {
  return usePostDetailScreenStore((s) => s.currentSlide);
}

const PaginationDots = memo(function PaginationDots({
  count,
  bottomOffset = 16,
  activeColor = "bg-primary",
  inactiveColor = "bg-foreground/50",
}: {
  count: number;
  bottomOffset?: number;
  activeColor?: string;
  inactiveColor?: string;
}) {
  const currentSlide = useCurrentSlide();
  if (count <= 1) return null;
  return (
    <View
      pointerEvents="none"
      style={{
        position: "absolute",
        bottom: bottomOffset,
        left: 0,
        right: 0,
        flexDirection: "row",
        justifyContent: "center",
        alignItems: "center",
        gap: 6,
      }}
    >
      {Array.from({ length: count }).map((_, i) => {
        const active = i === currentSlide;
        return (
          <View
            key={i}
            style={{
              width: active ? 12 : 6,
              height: 6,
              opacity: active ? 1 : 0.5,
            }}
            className={`h-1.5 rounded-full ${active ? activeColor : inactiveColor}`}
          />
        );
      })}
    </View>
  );
});

const SlideAwareTagOverlay = memo(function SlideAwareTagOverlay({
  postId,
  tagProgress,
}: {
  postId: string;
  tagProgress: SharedValue<number>;
}) {
  const currentSlide = useCurrentSlide();
  return (
    <TagOverlayViewer
      postId={postId}
      mediaIndex={currentSlide}
      tagProgress={tagProgress}
    />
  );
});

const TextSlideDots = memo(function TextSlideDots({ count }: { count: number }) {
  const currentSlide = useCurrentSlide();
  if (count <= 1) return null;
  return (
    <View
      style={{
        flexDirection: "row",
        justifyContent: "center",
        alignItems: "center",
        gap: 6,
        marginTop: 12,
      }}
      pointerEvents="none"
    >
      {Array.from({ length: count }).map((_, i) => {
        const active = i === currentSlide;
        return (
          <View
            key={i}
            style={{
              width: active ? 12 : 6,
              height: 6,
              borderRadius: 3,
              opacity: active ? 1 : 0.5,
              backgroundColor: active ? "#3FDCFF" : "rgba(255,255,255,0.38)",
            }}
          />
        );
      })}
    </View>
  );
});

type MediaItem = {
  type?: string;
  url?: string;
  thumbnail?: string;
  mimeType?: string;
  livePhotoVideoUrl?: string;
  updatedAt?: string | number;
};

const MediaSlide = memo(function MediaSlide({
  medium,
  galeriaIndex,
  width,
  height,
}: {
  medium: MediaItem;
  galeriaIndex: number;
  width: number;
  height: number;
}) {
  const isValidUrl =
    !!medium.url &&
    (medium.url.startsWith("http://") || medium.url.startsWith("https://"));

  return (
    <View style={{ width, height }}>
      {isValidUrl ? (
        <Galeria.Image index={galeriaIndex >= 0 ? galeriaIndex : 0}>
          {/*
            isPlaying is intentionally `true` for every slide. Gating it
            on `index === currentSlide` used to restart each GIF's native
            decoder on every swipe, which is the #1 cause of flicker in
            multi-GIF posts. expo-image's native GIF player is cheap when
            the slide is scrolled off-screen (no raster work for offscreen
            pixels), so there's no meaningful cost to leaving them on.
          */}
          <DVNTMediaRenderer
            item={medium as any}
            width={width}
            height={height}
            // Detail view slides: contain so every slide shows the
            // complete frame from top to bottom. The carousel frame
            // is a fixed 4:5 box; tall portraits used to lose heads
            // and wide landscapes used to lose context to center-crop.
            contentFit="contain"
            isPlaying
          />
        </Galeria.Image>
      ) : (
        <View
          style={{
            width,
            height,
            alignItems: "center",
            justifyContent: "center",
          }}
          className="bg-muted"
        >
          <Text className="text-muted-foreground text-xs">No image</Text>
        </View>
      )}
    </View>
  );
});

const MediaCarousel = memo(function MediaCarousel({
  media,
  imageUrls,
  width,
  height,
  onSlideChange,
}: {
  media: MediaItem[];
  imageUrls: string[];
  width: number;
  height: number;
  onSlideChange: (index: number) => void;
}) {
  const urlToIndex = useMemo(() => {
    const map = new Map<string, number>();
    imageUrls.forEach((u, i) => map.set(u, i));
    return map;
  }, [imageUrls]);

  const handleScroll = useCallback(
    (event: any) => {
      const slideIndex = Math.round(
        event.nativeEvent.contentOffset.x / width,
      );
      onSlideChange(slideIndex);
    },
    [onSlideChange, width],
  );

  return (
    <Galeria urls={imageUrls.length > 0 ? imageUrls : undefined}>
      <ScrollView
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onScroll={handleScroll}
        scrollEventThrottle={16}
      >
        {media.map((medium, index) => {
          const galeriaIndex = medium.url
            ? urlToIndex.get(medium.url) ?? -1
            : -1;
          return (
            <MediaSlide
              // Stable key by URL preserves component identity (and the
              // underlying GIF decoder state) across parent rerenders.
              // Fallback to index only for items with no URL.
              key={medium.url || `slot-${index}`}
              medium={medium}
              galeriaIndex={galeriaIndex}
              width={width}
              height={height}
            />
          );
        })}
      </ScrollView>
      <PaginationDots count={media.length} />
    </Galeria>
  );
});

function PostDetailScreenContent() {
  // DEV-only loop detection
  useRenderLoopDetector("PostDetail");

  const rawParams = useLocalSearchParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { colors } = useColorScheme();

  // FIX: Normalize params once to prevent string|string[] instability loops
  const normalizedParams = useMemo(
    () => normalizeRouteParams(rawParams),
    [rawParams.commentId, rawParams.id, rawParams.openComments],
  );

  loopDetection.log("PostDetail", "mount", { id: normalizedParams.id });

  // CRITICAL: Validate params but DON'T return early
  // Compute validation result, use for conditional rendering AFTER all hooks
  const paramsResult = validatePostParams(normalizedParams);
  const postId = paramsResult.valid ? paramsResult.postId : "";
  const targetCommentId = normalizedParams.commentId;
  const shouldOpenCommentsFromRoute =
    normalizedParams.openComments === "1" ||
    normalizedParams.openComments === "true";

  // CRITICAL: ALL HOOKS MUST BE CALLED UNCONDITIONALLY
  // Pass empty string if invalid - hooks will handle gracefully
  const { data: post, isLoading, error: postError } = usePost(postId);
  // Limit must match the comments sheet (app/(protected)/comments/[postId].tsx
  // also uses 50) so they share a React Query cache key. Different limits
  // → different keys → sheet refetches on open even though detail just
  // loaded the same comments.
  const { data: comments = [], isLoading: commentsLoading } = useComments(
    postId,
    50,
  );
  const { data: bookmarkedPostIds = [] } = useBookmarks();
  const toggleBookmarkMutation = useToggleBookmark();
  const currentUser = useAuthStore((state) => state.user);
  const showToast = useUIStore((state) => state.showToast);

  // Zustand selectors — NEVER subscribe to currentSlide at the root. It
  // changes on every carousel scroll; reading it here would force the whole
  // screen (including the media tree) to re-render on every swipe, which
  // is what caused GIFs in multi-media posts to flicker.
  // Downstream readers use selector-scoped subscriptions via
  // useCurrentSlide() below.
  const showActionSheet = usePostDetailScreenStore((s) => s.showActionSheet);
  const setShowActionSheet = usePostDetailScreenStore(
    (s) => s.setShowActionSheet,
  );
  const resetPostDetailScreen = usePostDetailScreenStore(
    (s) => s.resetPostDetailScreen,
  );

  const deletePostMutation = useDeletePost();
  const bookmarkStore = useBookmarkStore();
  const { open: openLikesSheet, prefetch: prefetchLikesSheet } =
    useLikesSheet();

  // Like state from centralized hook
  const {
    hasLiked: isPostLiked,
    likes: likeCount,
    toggle: toggleLike,
    isPending: isLikePending,
  } = usePostLikeState(
    postId,
    post?.likes || 0,
    post?.viewerHasLiked || false,
    post?.author?.id,
  );

  const isOwner = currentUser?.username === post?.author?.username;

  // Debug ownership check
  if (__DEV__) {
    console.log(`[PostDetail:${postId}] Owner check:`, {
      currentUsername: currentUser?.username,
      authorUsername: post?.author?.username,
      isOwner,
    });
  }

  const isBookmarked = useMemo(() => {
    return (
      bookmarkedPostIds.includes(postId) || bookmarkStore.isBookmarked(postId)
    );
  }, [postId, bookmarkedPostIds, bookmarkStore]);

  // Post tags (Instagram-style tap-to-reveal)
  const { data: postTags = [] } = usePostTags(postId);
  const tagsVisible = usePostTagsUIStore((s) => s.visibleTags[postId] ?? false);
  const toggleTags = usePostTagsUIStore((s) => s.toggleTags);
  const tagProgress = useSharedValue(0);

  const handleImageTap = useCallback(() => {
    if (postTags.length > 0) {
      const nextVisible = !tagsVisible;
      toggleTags(postId);
      if (nextVisible) {
        tagProgress.value = withSpring(1, {
          damping: 18,
          stiffness: 180,
          mass: 0.8,
        });
      } else {
        tagProgress.value = withTiming(0, { duration: 180 });
      }
    }
  }, [postTags.length, tagsVisible, toggleTags, postId, tagProgress]);

  // Setter-only subscription — stable function reference, does NOT
  // re-render the screen when currentSlide changes. Components that
  // actually need to READ currentSlide must subscribe via selector
  // in their own leaf component (see PaginationDots, SlideAwareTagOverlay
  // below) so the re-render is scoped to that leaf.
  const setCurrentSlide = usePostDetailScreenStore((s) => s.setCurrentSlide);

  // Cleanup effect - reset all screen state on unmount
  useEffect(() => {
    return () => {
      loopDetection.log("PostDetail", "unmount", { postId });
      resetPostDetailScreen();
    };
  }, [postId, resetPostDetailScreen]);

  // CRITICAL: Suspense-style guard - if post becomes null mid-render (e.g., deleted),
  // show loading state instead of crashing. This handles the case where:
  // 1. Initial render has cached post data
  // 2. Background refetch completes
  // 3. Post was deleted → query updates to null
  // 4. Component re-renders with null post
  // Without this guard, accessing post.media crashes the app.
  if (!post && !isLoading && !postError) {
    // Post became null after initial load (likely deleted)
    return (
      <SafeAreaView edges={["top"]} className="flex-1 bg-background">
        <View className="flex-row items-center border-b border-border bg-background px-4 py-3">
          <Pressable
            onPress={() => router.back()}
            hitSlop={16}
            style={{ padding: 8, margin: -8, marginRight: 8 }}
          >
            <ArrowLeft size={24} color={colors.foreground} />
          </Pressable>
          <Text className="text-lg font-semibold text-foreground">Post</Text>
        </View>
        <View className="flex-1 items-center justify-center p-4">
          <Text className="text-muted-foreground text-center">
            This post is no longer available
          </Text>
          <Pressable
            onPress={() => router.back()}
            className="mt-4 px-4 py-2 bg-primary rounded-lg"
          >
            <Text className="text-primary-foreground font-semibold">
              Go Back
            </Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  // NORMALIZATION: Create safePost with guaranteed non-null values
  // This prevents crashes if TanStack Query updates post to null during render
  const safePost = useMemo(() => normalizePost(post, postId), [post, postId]);
  const baseTextPresentation = useMemo(
    () =>
      resolveRenderableTextPostPresentation(
        safePost.textSlides,
        safePost.caption,
      ),
    [safePost.caption, safePost.textSlides],
  );
  const baseTextSlides = useMemo(
    () =>
      resolveDetailTextSlides(
        postId,
        undefined,
        baseTextPresentation.textSlides,
      ),
    [baseTextPresentation.textSlides, postId],
  );
  const shouldHydrateDetailTextSlides =
    safePost.kind === "text" &&
    !!postId &&
    ((typeof safePost.textSlideCount === "number" &&
      safePost.textSlideCount > baseTextSlides.length) ||
      baseTextSlides.length <= 1);
  const { data: hydratedTextPost } = useQuery({
    queryKey: ["postDetailTextSlides", postId],
    queryFn: () => postsApi.getPostById(postId),
    enabled: shouldHydrateDetailTextSlides,
    staleTime: 60_000,
    gcTime: 10 * 60 * 1000,
  });
  const hydratedTextPresentation = useMemo(
    () =>
      resolveRenderableTextPostPresentation(
        hydratedTextPost?.textSlides,
        hydratedTextPost?.caption,
      ),
    [hydratedTextPost?.caption, hydratedTextPost?.textSlides],
  );
  const resolvedTextSlides = useMemo(() => {
    const hydratedSlides = resolveDetailTextSlides(
      postId,
      undefined,
      hydratedTextPresentation.textSlides,
    );

    return hydratedSlides.length > baseTextSlides.length
      ? hydratedSlides
      : baseTextSlides;
  }, [baseTextSlides, hydratedTextPresentation.textSlides, postId]);
  const textPostCaption =
    hydratedTextPresentation.caption || baseTextPresentation.caption;

  // Navigate to user profile
  const handleProfilePress = useCallback(() => {
    const username = safePost.author?.username;
    if (!username) return;
    console.log(`[PostDetail] Navigating to profile: ${username}`);
    screenPrefetch.profile(queryClient, username);
    router.push({
      pathname: `/(protected)/profile/${username}`,
      params: {
        ...(safePost.author?.avatar ? { avatar: safePost.author.avatar } : {}),
        ...(safePost.author?.name ? { name: safePost.author.name } : {}),
      },
    } as any);
  }, [
    safePost.author?.username,
    safePost.author?.avatar,
    safePost.author?.name,
    router,
    queryClient,
  ]);

  const handleShare = useCallback(async () => {
    if (!postId || !safePost) return;
    try {
      const shareCaption =
        safePost.kind === "text"
          ? resolvedTextSlides[0]?.content || ""
          : safePost.caption || "";
      await sharePost(postId, shareCaption);
    } catch (error) {
      console.error("[PostDetail] Share error:", error);
    }
  }, [postId, resolvedTextSlides, safePost]);

  const handleActionEdit = useCallback(() => {
    if (postId) {
      loopDetection.log("PostDetail", "navigation:edit", { postId });
      router.push(`/(protected)/edit-post/${postId}`);
    }
    setShowActionSheet(false);
  }, [postId, router, setShowActionSheet]);

  const handleActionDelete = useCallback(() => {
    if (!postId) return;
    Alert.alert("Delete Post", "Are you sure you want to delete this post?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => {
          deletePostMutation.mutate(postId, {
            onSuccess: () => {
              showToast("success", "Deleted", "Post deleted");
              router.back();
            },
            onError: () => showToast("error", "Error", "Failed to delete post"),
          });
          setShowActionSheet(false);
        },
      },
    ]);
  }, [postId, deletePostMutation, showToast, router]);

  // CRITICAL: Compute all derived values and useMemo BEFORE early returns
  // These must be called unconditionally to maintain stable hook count
  const isTextPost = safePost.kind === "text";
  const isVideo = !isTextPost && safePost.media?.[0]?.type === "video";

  // Translation support for caption
  const { i18n } = useTranslation();
  const targetLang = i18n.language;
  const captionText = isTextPost ? textPostCaption : safePost.caption;
  const {
    displayText: translatedCaption,
    isTranslated: isCaptionTranslated,
    translate: translateCaptionFn,
    showOriginal: showOriginalCaption,
    isCapable: isTranslationCapable,
  } = useContentTranslation(
    `post-detail-${postId}-caption`,
    captionText || "",
    targetLang,
  );
  const handleTranslateCaption = useCallback(async () => {
    if (isCaptionTranslated) {
      showOriginalCaption();
    } else {
      await translateCaptionFn();
    }
  }, [isCaptionTranslated, showOriginalCaption, translateCaptionFn]);
  // P0-4: Do NOT gate the translate button on native capability. The
  // translation pipeline has a universal web fallback (MyMemory) that
  // works on all iOS/Android versions and network states. Gating on
  // native availability meant the button never appeared on iOS <18 or
  // devices without language packs — breaking translation end-to-end.
  // `isTranslationCapable` is still passed through for telemetry.
  const showTranslateButton = shouldShowTranslateButton(
    captionText || "",
    targetLang,
  );
  void isTranslationCapable;
  const hasMedia =
    safePost.media &&
    Array.isArray(safePost.media) &&
    safePost.media.length > 0;
  const hasMultipleMedia = hasMedia && safePost.media.length > 1 && !isVideo;
  const postIdString = safePost.id ? String(safePost.id) : postId;
  const handlePrimaryCommentsPress = useCallback(() => {
    if (!postIdString) return;
    router.push(`/(protected)/comments/${postIdString}`);
  }, [postIdString, router]);
  const notificationCommentRouteRef = useRef<string | null>(null);

  useEffect(() => {
    if (
      !shouldOpenCommentsFromRoute ||
      !postIdString ||
      isLoading ||
      (!!targetCommentId && commentsLoading)
    ) {
      return;
    }

    const routeKey = `${postIdString}:${targetCommentId || ""}`;
    if (notificationCommentRouteRef.current === routeKey) {
      return;
    }

    notificationCommentRouteRef.current = routeKey;
    screenPrefetch.comments(queryClient, postIdString);

    requestAnimationFrame(() => {
      const route = resolveCommentSheetRoute(
        postIdString,
        targetCommentId,
        comments,
      );
      router.push(route as any);
    });
  }, [
    isLoading,
    postIdString,
    comments,
    commentsLoading,
    queryClient,
    router,
    shouldOpenCommentsFromRoute,
    targetCommentId,
  ]);

  // Signature-keyed stabilization. `safePost.media` gets a new array
  // reference on every React Query refetch even when the URLs haven't
  // changed; that cascades into fresh references for imageUrls, the
  // <MediaCarousel /> props, and every slide's `medium` — which restarts
  // GIF decoders. Keying off a string signature preserves the array
  // identity across no-op refetches so downstream memos stay stable.
  const mediaSignature = useMemo(() => {
    if (!hasMedia) return "";
    return safePost.media
      .map((m: any) => `${m?.type ?? ""}::${m?.url ?? ""}`)
      .join("||");
  }, [hasMedia, safePost.media]);

  const stableMedia = useMemo(
    () => (hasMedia ? safePost.media : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mediaSignature],
  );

  // Collect valid image URLs for Galeria full-screen viewer
  const imageUrls = useMemo(() => {
    if (!hasMedia || isVideo) return [];
    return stableMedia
      .filter(
        (m: any) =>
          m.type !== "video" &&
          m.url &&
          (m.url.startsWith("http://") || m.url.startsWith("https://")),
      )
      .map((m: any) => m.url);
  }, [hasMedia, isVideo, stableMedia]);
  const isLiked = isPostLiked; // From usePostLikeState hook
  const isSaved = isBookmarked; // isBookmarked is already a boolean from useMemo
  const handleBookmarkPress = useCallback(() => {
    const bookmarkPostId = safePost.id ? String(safePost.id) : postId;
    if (!bookmarkPostId) return;
    toggleBookmarkMutation.mutate({
      postId: bookmarkPostId,
      isBookmarked: isSaved,
    });
  }, [postId, safePost.id, toggleBookmarkMutation, isSaved]);
  const commentCount = comments.reduce(
    (total, comment) =>
      total +
      1 +
      (comment.replies || []).reduce(
        (nested, reply) => nested + 1 + (reply.replies?.length || 0),
        0,
      ),
    0,
  );

  // EARLY RETURNS: Only AFTER all hooks have been called
  // Invalid params - show error UI
  if (!paramsResult.valid) {
    if (__DEV__) {
      console.error(
        "[PostDetail] Invalid params:",
        paramsResult.error,
        paramsResult.rawValue,
      );
    }
    return (
      <SafeAreaView edges={["top"]} className="flex-1 bg-background">
        <View className="flex-row items-center border-b border-border bg-background px-4 py-3">
          <Pressable
            onPress={() => router.back()}
            hitSlop={16}
            style={{ padding: 8, margin: -8, marginRight: 8 }}
          >
            <ArrowLeft size={24} color={colors.foreground} />
          </Pressable>
          <Text className="text-lg font-semibold text-foreground">Post</Text>
        </View>
        <View className="flex-1 items-center justify-center p-4">
          <Text className="text-muted-foreground text-center mb-2">
            Invalid post link
          </Text>
          <Text className="text-muted-foreground text-sm text-center mb-4">
            {paramsResult.error}
          </Text>
          <Pressable
            onPress={() => router.back()}
            className="px-4 py-2 bg-primary rounded-lg"
          >
            <Text className="text-primary-foreground font-semibold">
              Go Back
            </Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  // Empty postId after validation
  if (!postId) {
    return (
      <SafeAreaView edges={["top"]} className="flex-1 bg-background">
        <View className="flex-row items-center border-b border-border bg-background px-4 py-3">
          <Pressable
            onPress={() => router.back()}
            hitSlop={16}
            style={{ padding: 8, margin: -8, marginRight: 8 }}
          >
            <ArrowLeft size={24} color={colors.foreground} />
          </Pressable>
          <Text className="text-lg font-semibold text-foreground">Post</Text>
        </View>
        <View className="flex-1 items-center justify-center p-4">
          <Text className="text-muted-foreground text-center">
            Invalid post ID
          </Text>
          <Pressable
            onPress={() => router.back()}
            className="mt-4 px-4 py-2 bg-primary rounded-lg"
          >
            <Text className="text-primary-foreground font-semibold">
              Go Back
            </Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  if (isLoading) {
    return (
      <SafeAreaView edges={["top"]} className="flex-1 bg-background">
        <View className="flex-row items-center border-b border-border bg-background px-4 py-3">
          <Pressable
            onPress={() => router.back()}
            hitSlop={16}
            style={{ padding: 8, margin: -8, marginRight: 8 }}
          >
            <ArrowLeft size={24} color={colors.foreground} />
          </Pressable>
          <Text className="text-lg font-semibold text-foreground">Post</Text>
        </View>
        <PostDetailSkeleton />
      </SafeAreaView>
    );
  }

  // CRITICAL: Show error state with specific message
  // postError now contains meaningful error messages (not found, permission denied, etc.)
  if (postError) {
    const errorMessage = (postError as Error)?.message || "Failed to load post";
    console.log("[PostDetail] Error state:", { postId, errorMessage });

    return (
      <SafeAreaView edges={["top"]} className="flex-1 bg-background">
        <View className="flex-row items-center border-b border-border bg-background px-4 py-3">
          <Pressable
            onPress={() => router.back()}
            hitSlop={16}
            style={{ padding: 8, margin: -8, marginRight: 8 }}
          >
            <ArrowLeft size={24} color={colors.foreground} />
          </Pressable>
          <Text className="text-lg font-semibold text-foreground">Post</Text>
        </View>
        <View className="flex-1 items-center justify-center p-4">
          <Text className="text-muted-foreground text-center">
            {errorMessage}
          </Text>
          <Pressable
            onPress={() => router.back()}
            className="mt-4 px-4 py-2 bg-primary rounded-lg"
          >
            <Text className="text-primary-foreground font-semibold">
              Go Back
            </Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  // CRITICAL: Only show "not found" if we're not loading AND have no post
  // This prevents flash of "not found" during initial load
  if (!post) {
    console.log("[PostDetail] No post data:", { postId, isLoading });
    return (
      <SafeAreaView edges={["top"]} className="flex-1 bg-background">
        <View className="flex-row items-center border-b border-border bg-background px-4 py-3">
          <Pressable
            onPress={() => router.back()}
            hitSlop={16}
            style={{ padding: 8, margin: -8, marginRight: 8 }}
          >
            <ArrowLeft size={24} color={colors.foreground} />
          </Pressable>
          <Text className="text-lg font-semibold text-foreground">Post</Text>
        </View>
        <View className="flex-1 items-center justify-center p-4">
          <Text className="text-muted-foreground text-center">
            Post not found
          </Text>
          <Pressable
            onPress={() => router.back()}
            className="mt-4 px-4 py-2 bg-primary rounded-lg"
          >
            <Text className="text-primary-foreground font-semibold">
              Go Back
            </Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView
      edges={["top"]}
      className="flex-1 bg-background max-w-3xl w-full self-center"
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          paddingHorizontal: 12,
          paddingVertical: 10,
        }}
      >
        <Pressable
          onPress={() => router.back()}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <DVNTLiquidGlassIconButton size={40}>
            <ArrowLeft size={20} color="#fff" />
          </DVNTLiquidGlassIconButton>
        </Pressable>
        <Text className="text-lg font-semibold text-foreground">Post</Text>
        <Pressable
          onPress={() => setShowActionSheet(true)}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="More options"
        >
          <DVNTLiquidGlassIconButton size={40}>
            <MoreHorizontal size={20} color="#fff" />
          </DVNTLiquidGlassIconButton>
        </Pressable>
      </View>

      <ScrollView keyboardShouldPersistTaps="handled">
        <View className="border-b border-border">
          {/* Header */}
          <View className="flex-row items-center justify-between p-4 bg-card">
            <View className="flex-row items-center gap-3">
              <Pressable onPress={handleProfilePress}>
                <Avatar
                  uri={safePost.author?.avatar}
                  username={safePost.author?.username || "User"}
                  size="md"
                  variant="roundedSquare"
                />
              </Pressable>
              <View>
                {safePost.author?.username && (
                  <Pressable onPress={handleProfilePress}>
                    <Text className="text-base font-semibold text-foreground">
                      {safePost.author.username}
                    </Text>
                  </Pressable>
                )}
                {safePost.location && (
                  <Text className="text-sm text-muted-foreground">
                    {safePost.location}
                  </Text>
                )}
              </View>
            </View>
          </View>

          {/* Media - CRITICAL: Always render to maintain stable hook count */}
          <View
            style={{
              display: hasMedia ? "flex" : "none",
              width: SCREEN_WIDTH,
              height: PORTRAIT_HEIGHT,
              borderRadius: isVideo ? 0 : 12,
              overflow: "hidden",
            }}
            className="bg-muted"
          >
            {/* CRITICAL: Always render PostVideoPlayer to prevent hook-order violations
                  Pass empty URL for image posts - component handles gracefully */}
            <View
              style={{
                display: isVideo ? "flex" : "none",
                width: "100%",
                height: "100%",
              }}
            >
              <SafeMediaWrapper width={SCREEN_WIDTH} height={PORTRAIT_HEIGHT}>
                <PostVideoPlayer
                  postId={postId}
                  url={isVideo ? safePost.media?.[0]?.url : ""}
                />
              </SafeMediaWrapper>
            </View>

            <View
              style={{
                display: isVideo ? "none" : "flex",
                width: "100%",
                height: "100%",
              }}
            >
              <SafeMediaWrapper width={SCREEN_WIDTH} height={PORTRAIT_HEIGHT}>
                {hasMultipleMedia ? (
                  <MediaCarousel
                    media={stableMedia as MediaItem[]}
                    imageUrls={imageUrls}
                    width={SCREEN_WIDTH}
                    height={PORTRAIT_HEIGHT}
                    onSlideChange={setCurrentSlide}
                  />
                ) : stableMedia[0]?.url &&
                  (stableMedia[0].url.startsWith("http://") ||
                    stableMedia[0].url.startsWith("https://")) ? (
                  // Single media item — use DVNTMediaRenderer to handle
                  // gif / livePhoto / image. Galeria is kept around the
                  // single image for parity with the carousel lightbox.
                  <Galeria urls={imageUrls.length > 0 ? imageUrls : undefined}>
                    <Galeria.Image index={0}>
                      <DVNTMediaRenderer
                        item={stableMedia[0] as any}
                        width={SCREEN_WIDTH}
                        height={PORTRAIT_HEIGHT}
                        // Detail view: contain so the TOP of the photo is
                        // never cropped out. cover was center-cropping
                        // tall portraits (heads cut off). The 4:5 frame
                        // still anchors the composition; any aspect
                        // mismatch letterboxes cleanly on black.
                        contentFit="contain"
                        showBadge={true}
                        isPlaying={true}
                      />
                    </Galeria.Image>
                  </Galeria>
                ) : (
                  <View
                    style={{
                      width: "100%",
                      height: "100%",
                      alignItems: "center",
                      justifyContent: "center",
                      paddingHorizontal: 24,
                    }}
                  >
                    <Text className="text-foreground text-base font-medium text-center leading-6">
                      {safePost?.caption || "Media unavailable"}
                    </Text>
                  </View>
                )}
              </SafeMediaWrapper>
            </View>

            {/* Tag overlay — tap image to toggle, sits on top of all media */}
            <Pressable
              onPress={handleImageTap}
              style={{
                display: !isVideo && postTags.length > 0 ? "flex" : "none",
                position: "absolute",
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
              }}
            >
              <SlideAwareTagOverlay
                postId={postId}
                tagProgress={tagProgress}
              />
            </Pressable>
          </View>

          {/* Action rail — sits directly UNDER the image and is locked to
              the same width so the like / comment / share / bookmark
              controls align edge-to-edge with the media above. Prior
              design floated this as a glass pill INSIDE the image which
              covered part of the post. The inline variant reads much
              cleaner and lets us kill the overlap. */}
          {!isTextPost ? (
            <View
              style={{
                width: SCREEN_WIDTH,
                paddingHorizontal: 12,
                paddingTop: 10,
                paddingBottom: 6,
              }}
            >
              <PostDetailActionBar
                variant="inline"
                isLiked={isLiked}
                likeCount={likeCount}
                commentCount={commentCount}
                isBookmarked={isBookmarked}
                isLikePending={isLikePending}
                timeAgo={safePost.timeAgo}
                onLike={() => {
                  if (!postIdString || !post || isLikePending) return;
                  toggleLike();
                }}
                onComments={() => {
                  if (postIdString)
                    screenPrefetch.comments(queryClient, postIdString);
                  handlePrimaryCommentsPress();
                }}
                onShare={handleShare}
                onBookmark={handleBookmarkPress}
              />
            </View>
          ) : null}

          {/* Text-only post */}
          {isTextPost && (
            <View
              style={{
                width: SCREEN_WIDTH,
                paddingHorizontal: 20,
                paddingVertical: 18,
              }}
            >
              {resolvedTextSlides.length > 1 ? (
                <View>
                  <ScrollView
                    horizontal
                    pagingEnabled
                    showsHorizontalScrollIndicator={false}
                    onScroll={(event) => {
                      const slideW = SCREEN_WIDTH - 40;
                      const idx = Math.round(
                        event.nativeEvent.contentOffset.x / slideW,
                      );
                      setCurrentSlide(idx);
                    }}
                    scrollEventThrottle={16}
                  >
                    {resolvedTextSlides.map(
                      (
                        slide: { id: string; content: string },
                        index: number,
                      ) => (
                        <View
                          key={slide.id || index}
                          style={{ width: SCREEN_WIDTH - 40 }}
                        >
                          <TextPostSurface
                            text={slide.content}
                            theme={safePost.textTheme}
                            variant="detail"
                          />
                        </View>
                      ),
                    )}
                  </ScrollView>
                  <TextSlideDots count={resolvedTextSlides.length} />
                </View>
              ) : (
                <TextPostSurface
                  text={resolvedTextSlides[0]?.content || ""}
                  theme={safePost.textTheme}
                  variant="detail"
                />
              )}
              <PostDetailActionBar
                variant="inline"
                isLiked={isLiked}
                likeCount={likeCount}
                commentCount={commentCount}
                isBookmarked={isBookmarked}
                isLikePending={isLikePending}
                timeAgo={safePost.timeAgo}
                onLike={() => {
                  if (!postIdString || !post || isLikePending) return;
                  toggleLike();
                }}
                onComments={() => {
                  if (postIdString)
                    screenPrefetch.comments(queryClient, postIdString);
                  handlePrimaryCommentsPress();
                }}
                onShare={handleShare}
                onBookmark={handleBookmarkPress}
              />
              {textPostCaption ? (
                <View className="pt-4">
                  <Text
                    style={{
                      fontSize: 15,
                      color: colors.foreground,
                      lineHeight: 22,
                    }}
                  >
                    <Text
                      style={{ fontWeight: "700" }}
                      onPress={() =>
                        router.push(
                          `/(protected)/profile/${safePost.author?.username}` as any,
                        )
                      }
                    >
                      {safePost.author?.username || "Unknown User"}{" "}
                    </Text>
                    <HashtagText
                      text={translatedCaption}
                      textStyle={{ fontSize: 15, color: colors.foreground }}
                    />
                  </Text>
                  {showTranslateButton && (
                    <View className="mt-2">
                      <TranslateButton
                        onTranslate={handleTranslateCaption}
                        isTranslated={isCaptionTranslated}
                        onToggleOriginal={showOriginalCaption}
                        size="sm"
                        showLabel
                      />
                    </View>
                  )}
                </View>
              ) : null}
            </View>
          )}

          {/* Caption */}
          {safePost.caption && !isTextPost && (
            <View className="px-4 py-3">
              <Text
                style={{
                  fontSize: 15,
                  color: colors.foreground,
                  lineHeight: 22,
                }}
              >
                <Text
                  style={{ fontWeight: "700" }}
                  onPress={() =>
                    router.push(
                      `/(protected)/profile/${safePost.author?.username}` as any,
                    )
                  }
                >
                  {safePost.author?.username || "Unknown User"}{" "}
                </Text>
                <HashtagText
                  text={translatedCaption}
                  textStyle={{ fontSize: 15, color: colors.foreground }}
                />
              </Text>
              {showTranslateButton && (
                <View className="mt-2">
                  <TranslateButton
                    onTranslate={handleTranslateCaption}
                    isTranslated={isCaptionTranslated}
                    onToggleOriginal={showOriginalCaption}
                    size="sm"
                    showLabel
                  />
                </View>
              )}
            </View>
          )}
        </View>

        {/* Comments */}
        <View className="p-4">
          {commentsLoading ? (
            <Text className="text-center text-muted-foreground">
              Loading comments...
            </Text>
          ) : Array.isArray(comments) && comments.length > 0 ? (
            comments.map((comment) => {
              if (!comment || !comment.id) return null;
              return (
                <View key={comment.id} className="mb-4">
                  {/* Main comment */}
                  <View className="flex-row gap-3">
                    <Pressable
                      onPress={() => {
                        if (!comment.username) return;
                        router.push(`/(protected)/profile/${comment.username}`);
                      }}
                    >
                      <Avatar
                        uri={comment.avatar}
                        username={comment.username || "User"}
                        size="sm"
                        variant="roundedSquare"
                      />
                    </Pressable>
                    <View className="flex-1">
                      <Pressable
                        onPress={() => {
                          if (!comment.username) return;
                          router.push(
                            `/(protected)/profile/${comment.username}`,
                          );
                        }}
                      >
                        <Text className="text-sm text-foreground">
                          <Text className="font-semibold text-foreground">
                            {comment.username || "User"}
                          </Text>{" "}
                        </Text>
                      </Pressable>
                      <Text className="text-sm text-foreground">
                        {comment.text || ""}
                      </Text>
                      <Text className="mt-1 text-xs text-muted-foreground">
                        {comment.timeAgo}
                      </Text>

                      {/* Like and Reply buttons */}
                      <View className="mt-2 flex-row items-center gap-4">
                        <CommentLikeButton
                          postId={postIdString}
                          commentId={comment.id}
                          initialLikes={comment.likes}
                          initialHasLiked={comment.hasLiked}
                        />
                        <Pressable
                          onPress={() => {
                            if (!postIdString || !comment.id) return;
                            router.push(
                              `/(protected)/comments/replies/${comment.id}?postId=${postIdString}`,
                            );
                          }}
                        >
                          <Text className="text-xs text-primary">
                            {comment.replies?.length || 0}{" "}
                            {comment.replies?.length === 1
                              ? "reply"
                              : "replies"}
                          </Text>
                        </Pressable>
                      </View>
                    </View>
                  </View>

                  {/* Replies preview */}
                  {Array.isArray(comment.replies) &&
                    comment.replies.length > 0 && (
                      <View className="ml-11 mt-2">
                        {comment.replies.slice(0, 2).map((reply) => {
                          if (!reply || !reply.id) return null;
                          return (
                            <View
                              key={reply.id}
                              className="mb-2 flex-row gap-2"
                            >
                              <Pressable
                                onPress={() => {
                                  if (!reply.username) return;
                                  router.push(
                                    `/(protected)/profile/${reply.username}`,
                                  );
                                }}
                              >
                                <Avatar
                                  uri={reply.avatar}
                                  username={reply.username || "User"}
                                  size="xs"
                                  variant="roundedSquare"
                                />
                              </Pressable>
                              <View className="flex-1">
                                <Pressable
                                  onPress={() => {
                                    if (!reply.username) return;
                                    router.push(
                                      `/(protected)/profile/${reply.username}`,
                                    );
                                  }}
                                >
                                  <Text className="text-sm font-semibold text-foreground">
                                    {reply.username || "User"}
                                  </Text>
                                </Pressable>
                                <Text className="text-sm text-foreground">
                                  {reply.text || ""}
                                </Text>
                                <Text className="mt-1 text-xs text-muted-foreground">
                                  {reply.timeAgo || "Just now"}
                                </Text>
                              </View>
                            </View>
                          );
                        })}
                        {Array.isArray(comment.replies) &&
                          comment.replies.length > 2 && (
                            <Pressable
                              onPress={() => {
                                if (!postIdString || !comment.id) return;
                                router.push(
                                  `/(protected)/comments/${postIdString}?commentId=${comment.id}`,
                                );
                              }}
                              className="ml-7"
                            >
                              <Text className="text-xs text-muted-foreground">
                                View all {comment.replies.length} replies
                              </Text>
                            </Pressable>
                          )}
                      </View>
                    )}
                </View>
              );
            })
          ) : (
            <Text className="text-center text-muted-foreground">
              No comments yet
            </Text>
          )}
        </View>
      </ScrollView>

      <PostActionSheet
        visible={showActionSheet}
        onClose={() => setShowActionSheet(false)}
        isOwner={isOwner}
        onEdit={handleActionEdit}
        onDelete={handleActionDelete}
        onShare={handleShare}
        onTranslate={handleTranslateCaption}
        isTranslated={isCaptionTranslated}
        isTranslationCapable={showTranslateButton}
        onReport={() => {
          // Apple Guideline 1.2 — opens the global ReportSheet for the
          // current post detail. Non-owners only (sheet hides Report for owners).
          useReportSheetStore.getState().openReportSheet({
            entityType: "post",
            entityId: postIdString,
            label: post?.author?.username
              ? `@${post.author.username}`
              : undefined,
          });
        }}
      />
    </SafeAreaView>
  );
}

// Wrap with ErrorBoundary for crash protection (especially video)
export default function PostDetailScreen() {
  const router = useRouter();

  return (
    <ErrorBoundary
      screenName="PostDetail"
      onGoBack={() => router.back()}
      onGoHome={() => router.replace("/(protected)/(tabs)" as any)}
    >
      <PostDetailScreenContent />
    </ErrorBoundary>
  );
}
