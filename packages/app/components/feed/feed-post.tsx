/**
 * FeedPost — DVNT feed post item (immersive overlay redesign)
 *
 * Layout:
 *   Article (borderRadius: 12, overflow hidden)
 *     ├─ Media block (video | carousel | single image)
 *     │    ├─ OVERLAY top-left:    [Avatar + username] liquid glass
 *     │    ├─ OVERLAY top-center:  carousel dots (multi-image only)
 *     │    ├─ OVERLAY top-right:   [⋮] liquid glass icon button
 *     │    ├─ OVERLAY bottom-left: [❤ n] [💬 n] [→] [🔖] liquid glass pill
 *     │    ├─ OVERLAY bottom-right:[⤢] liquid glass icon button (video only)
 *     │    └─ OVERLAY bottom:      gradient seek bar (video only, always visible)
 *     └─ Caption block (below media, inside card)
 *
 * State: all in useFeedPostUIStore (Zustand) — no local useState.
 */
import {
  View,
  Text,
  Pressable,
  ScrollView,
  Modal,
  StatusBar,
} from "react-native";
import { Article } from "@expo/html-elements";
import { Avatar } from "@dvnt/app/components/ui/avatar";
import {
  Heart,
  MessageCircle,
  Send,
  Bookmark,
  MoreHorizontal,
  Maximize2,
  Minimize2,
  Play,
} from "lucide-react-native";
import { useRouter } from "expo-router";
import { useColorScheme } from "@dvnt/app/lib/hooks";
import { useFeedSlideStore } from "@dvnt/app/lib/stores/post-store";
import { usePostLikeState } from "@dvnt/app/lib/hooks/usePostLikeState";
import { usePrefetchComments } from "@dvnt/app/lib/hooks/use-comments";
import { useToggleBookmark } from "@dvnt/app/lib/hooks/use-bookmarks";
import type { Comment } from "@dvnt/app/lib/types";
import { VideoView, useVideoPlayer } from "expo-video";
import {
  useCallback,
  useEffect,
  memo,
  useMemo,
  useRef,
  useState,
  type ElementRef,
} from "react";
import { useIsFocused } from "@react-navigation/native";
import {
  useVideoLifecycle,
  safePlay,
  safePause,
  safeMute,
  safeSeek,
  safeGetCurrentTime,
  safeGetDuration,
  cleanupPlayer,
  logVideoHealth,
} from "@dvnt/app/lib/video-lifecycle";
import { DVNTSeekBar } from "@dvnt/app/components/media/DVNTSeekBar";
import {
  DVNTLiquidGlass,
  DVNTLiquidGlassIconButton,
} from "@dvnt/app/components/media/DVNTLiquidGlass";
import { DVNTMediaRenderer } from "@dvnt/app/components/media/DVNTMediaRenderer";
import { useFeedPostUIStore } from "@dvnt/app/lib/stores/feed-post-store";
import { HashtagText } from "@dvnt/app/components/ui/hashtag-text";
import { TextPostBadgeLogo } from "@dvnt/app/components/post/TextPostBadgeLogo";
import { TextPostSurface } from "@dvnt/app/components/post/TextPostSurface";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import { useBookmarkStore } from "@dvnt/app/lib/stores/bookmark-store";
import { routeToProfile } from "@dvnt/app/lib/utils/route-to-profile";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { navigateToPost } from "@dvnt/app/lib/routes/post-routes";
import { formatLikeCount } from "@dvnt/app/lib/utils/format-count";
import { useResponsiveMedia } from "@dvnt/app/lib/hooks/use-responsive-media";
import { TagOverlayViewer } from "@dvnt/app/components/tags/TagOverlayViewer";
import { usePostTags } from "@dvnt/app/lib/hooks/use-post-tags";
import { usePostTagsUIStore } from "@dvnt/app/lib/stores/post-tags-store";
import { postsApi } from "@dvnt/app/lib/api/posts";
import {
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { Volume2, VolumeX } from "lucide-react-native";
import { resolveRenderableTextPostPresentation } from "@dvnt/app/lib/posts/text-post";
import type { PublicGateReason } from "@dvnt/app/lib/access/public-gates";
import { shouldHydrateFeedTextSlides } from "@dvnt/app/lib/feed/text-hydration";
import { useTranslation } from "react-i18next";
import { TranslateButton } from "@dvnt/app/components/ui/translate-button";
import { useContentTranslation } from "@dvnt/app/lib/stores/translation-store";
import { shouldShowTranslateButton } from "@dvnt/app/lib/utils/language-detection";

const CARD_HORIZONTAL_MARGIN = 4;
const CARD_BORDER_WIDTH = 1;

interface FeedPostProps {
  id: string;
  author: {
    username: string;
    avatar: string;
    verified?: boolean;
    id?: string;
  };
  media: import("@dvnt/app/lib/types").PostMediaItem[];
  kind?: import("@dvnt/app/lib/types").PostKind;
  textTheme?: import("@dvnt/app/lib/types").TextPostThemeKey;
  caption?: string;
  textSlides?: import("@dvnt/app/lib/types").TextPostSlide[];
  textSlideCount?: number;
  likes: number;
  viewerHasLiked?: boolean;
  comments: Comment[] | number;
  timeAgo: string;
  location?: string;
  isNSFW?: boolean;
  onShowLikes?: (postId: string) => void;
  guestMode?: boolean;
  onGuestGate?: (reason: PublicGateReason) => void;
}

// ─────────────────────────────── helpers ────────────────────────────────────

/** Carousel dot pill at top-center in brand gradient colors */
function CarouselDots({ count, current }: { count: number; current: number }) {
  const COLORS = ["#3FDCFF", "#8A40CF", "#FF5BFC"];
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
      {Array.from({ length: count }).map((_, i) => (
        <View
          key={i}
          style={{
            width: i === current ? 18 : 7,
            height: 7,
            borderRadius: 4,
            backgroundColor:
              i === current
                ? COLORS[i % COLORS.length]
                : "rgba(255,255,255,0.38)",
            opacity: i === current ? 1 : 0.7,
            boxShadow: "0 1px 3px rgba(0,0,0,0.6)",
          }}
        />
      ))}
    </View>
  );
}

// ─────────────────────────────── component ──────────────────────────────────

function FeedPostComponent({
  id,
  author,
  media,
  kind,
  textTheme,
  caption,
  textSlides,
  textSlideCount,
  likes,
  viewerHasLiked = false,
  comments,
  timeAgo,
  location,
  isNSFW,
  onShowLikes: _onShowLikes,
  guestMode = false,
  onGuestGate,
}: FeedPostProps) {
  const router = useRouter();
  const { colors } = useColorScheme();
  const queryClient = useQueryClient();

  const {
    width: mediaSize,
    height: PORTRAIT_HEIGHT,
    containerClass,
  } = useResponsiveMedia("portrait", {
    cardMargin: CARD_HORIZONTAL_MARGIN,
    cardBorder: CARD_BORDER_WIDTH,
  });

  const {
    hasLiked,
    likes: likesCount,
    toggle: toggleLike,
    isPending: isLikePending,
  } = usePostLikeState(id, likes, viewerHasLiked, author?.id);

  const toggleBookmarkMutation = useToggleBookmark();
  const { currentSlides, setCurrentSlide } = useFeedSlideStore();
  const bookmarkStore = useBookmarkStore();
  const prefetchComments = usePrefetchComments();
  const currentUserId = useAuthStore((state) => state.user?.id);

  // Post tags
  const { data: postTags = [] } = usePostTags(id);
  const tagsVisible = usePostTagsUIStore((s) => s.visibleTags[id] ?? false);
  const toggleTags = usePostTagsUIStore((s) => s.toggleTags);
  const tagProgress = useSharedValue(0);

  // Feed post UI store (replaces all useState)
  // Selector-per-field: FeedPost renders once per post in the feed FlatList.
  // The previous destructure subscribed each row to the entire store, so
  // any post opening an action sheet would re-render every other post.
  // Selectors scope re-renders to the exact field each row cares about.
  const setPressedPost = useFeedPostUIStore((s) => s.setPressedPost);
  const setLikeAnimating = useFeedPostUIStore((s) => s.setLikeAnimating);
  const setVideoState = useFeedPostUIStore((s) => s.setVideoState);
  const getVideoState = useFeedPostUIStore((s) => s.getVideoState);
  // Derived boolean — each row only re-renders when its OWN activeness
  // flips, not on every scroll event that changes the active post anywhere.
  const isActivePost = useFeedPostUIStore((s) => s.activePostId === id);
  const isMuted = useFeedPostUIStore((s) => s.isMuted);
  const toggleMute = useFeedPostUIStore((s) => s.toggleMute);
  const setActionSheetPostId = useFeedPostUIStore(
    (s) => s.setActionSheetPostId,
  );
  const setShareSheetPostId = useFeedPostUIStore(
    (s) => s.setShareSheetPostId,
  );

  const videoState = getVideoState(id);
  const videoCurrentTime = videoState.currentTime;
  const videoDuration = videoState.duration;

  // Card inner width (for seek bar)
  const cardInnerWidthRef = useRef(mediaSize);
  const videoViewRef = useRef<ElementRef<typeof VideoView>>(null);

  const isTextPost = kind === "text";
  const initialTextPresentation = useMemo(
    () => resolveRenderableTextPostPresentation(textSlides, caption),
    [caption, textSlides],
  );
  const initialTextSlides = initialTextPresentation.textSlides;
  const shouldHydrateTextSlides = shouldHydrateFeedTextSlides({
    isTextPost,
    id,
    textSlideCount,
    initialTextSlidesLength: initialTextSlides.length,
    caption,
  });
  const { data: hydratedTextPost } = useQuery({
    queryKey: ["feedTextPostSlides", id],
    queryFn: () => postsApi.getPostById(id),
    enabled: shouldHydrateTextSlides,
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
    const hydratedSlides = hydratedTextPresentation.textSlides;

    return hydratedSlides.length > initialTextSlides.length
      ? hydratedSlides
      : initialTextSlides;
  }, [hydratedTextPresentation.textSlides, initialTextSlides]);
  const textPostCaption =
    hydratedTextPresentation.caption || initialTextPresentation.caption;
  const hasMultipleTextSlides = isTextPost && resolvedTextSlides.length > 1;

  // Translation support
  // For text posts: use the resolved text slide caption.
  // For media posts: use the raw caption prop so media-post captions are translatable.
  const { i18n } = useTranslation();
  const targetLang = i18n.language;
  const captionForTranslation = isTextPost ? (textPostCaption || "") : (caption || "");
  const {
    displayText: translatedCaption,
    isTranslated: isCaptionTranslated,
    translate: translateCaptionFn,
    showOriginal: showOriginalCaption,
    isCapable: isTranslationCapable,
  } = useContentTranslation(
    `post-${id}-caption`,
    captionForTranslation,
    targetLang,
  );

  const handleTranslateCaption = useCallback(async () => {
    await translateCaptionFn();
  }, [translateCaptionFn]);
  // Show translate button when: device is capable (or capability still loading)
  // AND language detection says text is in a foreign language.
  const showTranslateButton =
    isTranslationCapable !== false &&
    shouldShowTranslateButton(captionForTranslation, targetLang);

  const hasMedia = media && media.length > 0;
  const isVideo = !isTextPost && hasMedia && media[0]?.type === "video";
  const hasMultipleMedia =
    !isTextPost && hasMedia && media.length > 1 && !isVideo;
  const currentSlide = currentSlides[id] || 0;

  const isFocused = useIsFocused();

  const { isMountedRef, safeInterval, clearSafeInterval, isSafeToOperate } =
    useVideoLifecycle("FeedPost", id);

  const videoUrl = useMemo(() => {
    if (isVideo && media[0]?.url) {
      const url = media[0].url;
      if (url && (url.startsWith("http://") || url.startsWith("https://"))) {
        return url;
      }
    }
    return null;
  }, [isVideo, media]);
  const hasPlayableVideo = Boolean(isVideo && videoUrl);

  const player = useVideoPlayer(videoUrl, (p) => {
    if (p && hasPlayableVideo && isMountedRef.current) {
      try {
        p.loop = false;
        p.muted = isMuted;
        // Never preempt background audio from feed scrolling. Muted
        // videos: always mixWithOthers. Unmuted (user tapped to
        // hear it): duck other audio (lower their Spotify) rather
        // than stopping it entirely — matches the user contract
        // "audio should only stop when a story plays".
        p.audioMixingMode = isMuted ? "mixWithOthers" : "duckOthers";
        logVideoHealth("FeedPost", "player configured", { id });
      } catch (error) {
        logVideoHealth("FeedPost", "config error", { error: String(error) });
      }
    }
  });

  // Mute sync — also re-assigns audioMixingMode so toggling the speaker
  // in the feed switches between "don't touch background audio" (muted)
  // and "duck it while video plays" (unmuted). Without this the mode
  // stays whatever it was on first render.
  useEffect(() => {
    if (hasPlayableVideo && player) {
      safeMute(player, isMountedRef, isMuted, "FeedPost");
      try {
        player.audioMixingMode = isMuted ? "mixWithOthers" : "duckOthers";
      } catch {}
    }
  }, [hasPlayableVideo, player, isMuted, isMountedRef]);

  // Play/pause based on focus + active + not fullscreen
  useEffect(() => {
    if (!hasPlayableVideo || !player) return;
    if (isSafeToOperate()) {
      if (isFocused && isActivePost) {
        safePlay(player, isMountedRef, "FeedPost");
      } else {
        safePause(player, isMountedRef, "FeedPost");
      }
    }
    return () => {
      if (hasPlayableVideo && player) cleanupPlayer(player, "FeedPost");
    };
  }, [
    isFocused,
    hasPlayableVideo,
    player,
    isActivePost,
    id,
    isMountedRef,
    isSafeToOperate,
  ]);

  // Poll seek bar progress
  useEffect(() => {
    if (!hasPlayableVideo || !player) return;
    const interval = safeInterval(() => {
      if (!isSafeToOperate()) return;
      const ct = safeGetCurrentTime(player, isMountedRef, "FeedPost");
      const dur = safeGetDuration(player, isMountedRef, "FeedPost");
      setVideoState(id, { currentTime: ct, duration: dur });
    }, 250);
    return () => clearSafeInterval(interval);
  }, [
    hasPlayableVideo,
    player,
    id,
    setVideoState,
    safeInterval,
    clearSafeInterval,
    isMountedRef,
    isSafeToOperate,
  ]);

  // ── handlers ──

  const handleVideoSeek = useCallback(
    (time: number) => safeSeek(player, isMountedRef, time, "FeedPost"),
    [player, isMountedRef],
  );

  const openGuestGate = useCallback(
    (reason: PublicGateReason) => {
      onGuestGate?.(reason);
    },
    [onGuestGate],
  );

  const handleVideoPress = useCallback(() => {
    if (guestMode) {
      openGuestGate("post");
      return;
    }
    if (!isSafeToOperate() || !id) return;
    navigateToPost(router, queryClient, id);
  }, [guestMode, id, isSafeToOperate, openGuestGate, queryClient, router]);

  const handleLike = useCallback(() => {
    if (guestMode) {
      openGuestGate("engage");
      return;
    }
    if (isLikePending) return;
    setLikeAnimating(id, true);
    toggleLike();
    setTimeout(() => setLikeAnimating(id, false), 300);
  }, [
    guestMode,
    id,
    isLikePending,
    openGuestGate,
    setLikeAnimating,
    toggleLike,
  ]);

  const handleSave = useCallback(() => {
    if (guestMode) {
      openGuestGate("engage");
      return;
    }
    const isSaved = bookmarkStore.isBookmarked(id);
    toggleBookmarkMutation.mutate({ postId: id, isBookmarked: isSaved });
  }, [guestMode, id, bookmarkStore, openGuestGate, toggleBookmarkMutation]);

  const handleCommentsPress = useCallback(() => {
    if (guestMode) {
      openGuestGate("comments");
      return;
    }
    if (!id) return;
    router.push(`/(protected)/comments/${id}` as any);
  }, [guestMode, id, openGuestGate, router]);

  const textSlideWidth = mediaSize - 32;

  const handleScroll = useCallback(
    (event: any) => {
      const w = isTextPost
        ? textSlideWidth
        : cardInnerWidthRef.current || mediaSize;
      const slideIndex = Math.round(event.nativeEvent.contentOffset.x / w);
      setCurrentSlide(id, slideIndex);
    },
    [id, setCurrentSlide, mediaSize, isTextPost, textSlideWidth],
  );

  const handlePressIn = useCallback(
    () => setPressedPost(id, true),
    [id, setPressedPost],
  );
  const handlePressOut = useCallback(
    () => setPressedPost(id, false),
    [id, setPressedPost],
  );

  const handlePostPress = useCallback(() => {
    if (guestMode) {
      openGuestGate("post");
      return;
    }
    if (!id) return;
    if (postTags.length > 0) {
      toggleTags(id);
      tagProgress.value = tagsVisible
        ? withTiming(0, { duration: 180 })
        : withSpring(1, { damping: 18, stiffness: 180, mass: 0.8 });
      return;
    }
    navigateToPost(router, queryClient, id);
  }, [
    router,
    id,
    postTags.length,
    tagsVisible,
    toggleTags,
    tagProgress,
    queryClient,
    guestMode,
    openGuestGate,
  ]);

  const handleProfilePress = useCallback(() => {
    if (!author?.username) return;
    routeToProfile({
      targetUserId: author?.id,
      targetUsername: author?.username,
      targetAvatar: author?.avatar,
      targetName: author?.username,
      viewerId: currentUserId,
      router,
      queryClient,
      guestMode,
    });
  }, [
    router,
    author?.username,
    author?.id,
    author?.avatar,
    currentUserId,
    guestMode,
    queryClient,
  ]);

  const handleCaptionHashtagPress = useCallback(
    (hashtag: string) => {
      if (guestMode) {
        router.push({
          pathname: "/(public)/search",
          params: { query: `#${hashtag}` },
        } as any);
        return;
      }

      router.push({
        pathname: "/(protected)/search",
        params: { query: `#${hashtag}` },
      } as any);
    },
    [guestMode, router],
  );

  const handleCaptionMentionPress = useCallback(
    (mentionUsername: string) => {
      routeToProfile({
        targetUserId: undefined,
        targetUsername: mentionUsername,
        targetName: mentionUsername,
        viewerId: currentUserId,
        router,
        queryClient,
        guestMode,
      });
    },
    [currentUserId, guestMode, queryClient, router],
  );

  const isFullscreen = useFeedPostUIStore(
    (s) => s.getVideoState(id).isFullscreen,
  );
  const handleFullscreenToggle = useCallback(() => {
    if (guestMode) {
      openGuestGate("post");
      return;
    }
    setVideoState(id, { isFullscreen: !isFullscreen });
  }, [guestMode, id, isFullscreen, openGuestGate, setVideoState]);

  const handleMorePress = useCallback(() => {
    if (guestMode) {
      openGuestGate("post");
      return;
    }
    setActionSheetPostId(id);
  }, [guestMode, id, openGuestGate, setActionSheetPostId]);

  const handleSharePress = useCallback(() => {
    if (guestMode) {
      openGuestGate("messages");
      return;
    }
    setShareSheetPostId(id);
  }, [guestMode, id, openGuestGate, setShareSheetPostId]);

  const isBookmarked = bookmarkStore.isBookmarked(id);
  const commentCount = Array.isArray(comments) ? comments.length : comments;

  // ── bottom overlay bottom offset: shift up if video (seek bar takes 24px at very bottom) ──
  const socialBottom = hasPlayableVideo ? 34 : 14;

  // ── render ──

  return (
    <View className={containerClass}>
      <Article
        style={{
          marginHorizontal: CARD_HORIZONTAL_MARGIN,
          marginVertical: 16,
          borderRadius: 12,
          borderWidth: CARD_BORDER_WIDTH,
          borderColor: colors.border,
          backgroundColor: colors.card,
          overflow: "hidden",
        }}
      >
        {isTextPost ? (
          <View style={{ padding: 16 }}>
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 14,
              }}
            >
              <Pressable
                onPress={handleProfilePress}
                style={{ flexDirection: "row", alignItems: "center", gap: 10 }}
              >
                <Avatar
                  uri={author?.avatar}
                  username={author?.username || "User"}
                  size={38}
                  variant="roundedSquare"
                />
                <View style={{ maxWidth: 220 }}>
                  <Text
                    numberOfLines={1}
                    style={{
                      color: "#fff",
                      fontSize: 15,
                      fontWeight: "800",
                    }}
                  >
                    {author?.username}
                  </Text>
                  <Text
                    numberOfLines={1}
                    style={{
                      color: "rgba(226,232,240,0.68)",
                      fontSize: 12,
                      marginTop: 2,
                    }}
                  >
                    {[location, isNSFW ? "Spicy" : null, timeAgo]
                      .filter(Boolean)
                      .join(" · ")}
                  </Text>
                </View>
              </Pressable>

              <View
                style={{ flexDirection: "row", alignItems: "center", gap: 8 }}
              >
                <View
                  style={{
                    width: 118,
                    height: 32,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <TextPostBadgeLogo width={102} height={22} />
                </View>
                <Pressable
                  onPress={handleMorePress}
                  hitSlop={12}
                  accessibilityRole="button"
                  accessibilityLabel="More options"
                  style={{
                    width: 38,
                    height: 38,
                    borderRadius: 12,
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: "rgba(255,255,255,0.04)",
                    borderWidth: 1,
                    borderColor: "rgba(255,255,255,0.08)",
                  }}
                >
                  <MoreHorizontal size={20} color="#fff" />
                </Pressable>
              </View>
            </View>

            {hasMultipleTextSlides ? (
              <View>
                <ScrollView
                  horizontal
                  pagingEnabled
                  showsHorizontalScrollIndicator={false}
                  onScroll={handleScroll}
                  scrollEventThrottle={16}
                  contentContainerStyle={{ gap: 0 }}
                >
                  {resolvedTextSlides.map((slide, index) => (
                    <Pressable
                      key={slide.id || index}
                      onPress={handlePostPress}
                      style={{ width: textSlideWidth }}
                    >
                      <TextPostSurface
                        text={slide.content}
                        theme={textTheme}
                        variant="feed"
                      />
                    </Pressable>
                  ))}
                </ScrollView>
                <View
                  style={{
                    alignItems: "center",
                    marginTop: 10,
                  }}
                  pointerEvents="none"
                >
                  <CarouselDots
                    count={resolvedTextSlides.length}
                    current={currentSlide}
                  />
                </View>
              </View>
            ) : (
              <Pressable onPress={handlePostPress}>
                <TextPostSurface
                  text={resolvedTextSlides[0]?.content || ""}
                  theme={textTheme}
                  variant="feed"
                />
              </Pressable>
            )}

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
              <View
                style={{ flexDirection: "row", alignItems: "center", gap: 18 }}
              >
                <Pressable
                  onPress={handleLike}
                  disabled={isLikePending}
                  style={{ flexDirection: "row", alignItems: "center", gap: 6 }}
                >
                  <Heart
                    size={20}
                    color={hasLiked ? "#FF5BFC" : "#fff"}
                    fill={hasLiked ? "#FF5BFC" : "none"}
                  />
                  <Text
                    style={{ color: "#fff", fontSize: 13, fontWeight: "700" }}
                  >
                    {formatLikeCount(likesCount)}
                  </Text>
                </Pressable>

                <Pressable
                  onPressIn={() => id && prefetchComments(id)}
                  onPress={handleCommentsPress}
                  style={{ flexDirection: "row", alignItems: "center", gap: 6 }}
                >
                  <MessageCircle size={20} color="#fff" />
                  <Text
                    style={{ color: "#fff", fontSize: 13, fontWeight: "700" }}
                  >
                    {commentCount || 0}
                  </Text>
                </Pressable>

                <Pressable onPress={handleSharePress} hitSlop={8}>
                  <Send size={20} color="#fff" />
                </Pressable>

                <Pressable onPress={handleSave} hitSlop={8}>
                  <Bookmark
                    size={20}
                    color={isBookmarked ? "#3FDCFF" : "#fff"}
                    fill={isBookmarked ? "#3FDCFF" : "none"}
                  />
                </Pressable>
              </View>

              <Text
                style={{
                  color: "rgba(226,232,240,0.62)",
                  fontSize: 11,
                  fontWeight: "700",
                  textTransform: "uppercase",
                }}
              >
                {timeAgo}
              </Text>
            </View>
            {textPostCaption ? (
              <View style={{ marginTop: 14 }}>
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "flex-start",
                    justifyContent: "space-between",
                    gap: 8,
                  }}
                >
                  <Text
                    style={{
                      flex: 1,
                      fontSize: 14,
                      lineHeight: 20,
                      color: "rgba(248,250,252,0.92)",
                    }}
                  >
                    <Text
                      style={{ fontWeight: "700", color: "#fff" }}
                      onPress={handleProfilePress}
                    >
                      {author?.username || "Unknown User"}{" "}
                    </Text>
                    <HashtagText
                      text={translatedCaption}
                      onHashtagPress={handleCaptionHashtagPress}
                      onMentionPress={handleCaptionMentionPress}
                      textStyle={{
                        fontSize: 14,
                        lineHeight: 20,
                        color: "rgba(226,232,240,0.82)",
                      }}
                    />
                  </Text>
                  {showTranslateButton && (
                    <TranslateButton
                      onTranslate={handleTranslateCaption}
                      isTranslated={isCaptionTranslated}
                      onToggleOriginal={showOriginalCaption}
                      size="sm"
                    />
                  )}
                </View>
              </View>
            ) : null}
          </View>
        ) : hasMedia ? (
          <View
            onLayout={(e) => {
              const w = e.nativeEvent.layout.width;
              if (w > 0) cardInnerWidthRef.current = w;
            }}
            style={{
              width: "100%",
              height: PORTRAIT_HEIGHT,
              position: "relative",
              overflow: "hidden",
            }}
            className="bg-muted"
          >
            {/* ── Media content ── */}
            {isVideo ? (
              hasPlayableVideo ? (
                <Pressable
                  onPress={handleVideoPress}
                  onPressIn={handlePressIn}
                  onPressOut={handlePressOut}
                  style={{ width: "100%", height: "100%" }}
                >
                  <View
                    pointerEvents="none"
                    style={{ width: "100%", height: "100%" }}
                  >
                    <VideoView
                      ref={videoViewRef}
                      player={player}
                      style={{ width: "100%", height: "100%" }}
                      contentFit="cover"
                      nativeControls={false}
                    />
                  </View>
                </Pressable>
              ) : (
                <Pressable
                  onPress={handlePostPress}
                  onPressIn={handlePressIn}
                  onPressOut={handlePressOut}
                  style={{ width: "100%", height: "100%" }}
                >
                  <View
                    style={{ width: "100%", height: "100%" }}
                    className="bg-muted items-center justify-center"
                  >
                    <Text className="text-muted-foreground text-xs">
                      Video unavailable
                    </Text>
                  </View>
                </Pressable>
              )
            ) : hasMultipleMedia ? (
              <>
                <View style={{ width: "100%", height: "100%" }}>
                  <ScrollView
                    horizontal
                    pagingEnabled
                    showsHorizontalScrollIndicator={false}
                    onScroll={handleScroll}
                    scrollEventThrottle={16}
                  >
                    {media.map((medium, index) => {
                      const isValidUrl =
                        medium.url &&
                        (medium.url.startsWith("http://") ||
                          medium.url.startsWith("https://"));
                      return (
                        <Pressable
                          key={index}
                          onPress={handlePostPress}
                          onPressIn={handlePressIn}
                          onPressOut={handlePressOut}
                        >
                          {isValidUrl ? (
                            <DVNTMediaRenderer
                              item={medium}
                              width={cardInnerWidthRef.current}
                              height={PORTRAIT_HEIGHT}
                              contentFit="cover"
                              showBadge={index === 0}
                              isPlaying={isActivePost && isFocused && index === currentSlide}
                            />
                          ) : (
                            <View
                              style={{
                                width: cardInnerWidthRef.current,
                                height: PORTRAIT_HEIGHT,
                              }}
                              className="bg-muted items-center justify-center"
                            >
                              <Text className="text-muted-foreground text-xs">
                                No image
                              </Text>
                            </View>
                          )}
                        </Pressable>
                      );
                    })}
                  </ScrollView>
                </View>
              </>
            ) : (() => {
              const singleUrl = media[0]?.url;
              const isValidSingleUrl =
                singleUrl &&
                (singleUrl.startsWith("http://") ||
                  singleUrl.startsWith("https://"));
              return (
                <Pressable
                  onPress={handlePostPress}
                  onPressIn={handlePressIn}
                  onPressOut={handlePressOut}
                  style={{ width: "100%", height: PORTRAIT_HEIGHT }}
                >
                  {isValidSingleUrl ? (
                    <DVNTMediaRenderer
                      item={media[0]}
                      width="100%"
                      height={PORTRAIT_HEIGHT}
                      contentFit="cover"
                      showBadge={false}
                      isPlaying={isActivePost && isFocused}
                    />
                  ) : (
                    <View
                      style={{ width: "100%", height: PORTRAIT_HEIGHT }}
                      className="bg-muted items-center justify-center"
                    >
                      <Text className="text-muted-foreground text-xs">
                        No image
                      </Text>
                    </View>
                  )}
                </Pressable>
              );
            })()}

            {/* ── Tag overlay ── */}
            {!isVideo && postTags.length > 0 && (
              <TagOverlayViewer
                postId={id}
                mediaIndex={currentSlide}
                tagProgress={tagProgress}
                guestMode={guestMode}
              />
            )}

            {/* ═══════════ OVERLAYS ══════════════════════════════════ */}

            {/* TOP-LEFT: Avatar + username */}
            <Pressable
              onPress={handleProfilePress}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                zIndex: 50,
              }}
              hitSlop={8}
            >
              <DVNTLiquidGlass paddingH={6} paddingV={5} radius={12}>
                <Avatar
                  uri={author?.avatar}
                  username={author?.username || "User"}
                  size={34}
                  variant="roundedSquare"
                />
                <View style={{ flexDirection: "column", maxWidth: 140 }}>
                  <Text
                    numberOfLines={1}
                    style={{
                      color: "#fff",
                      fontSize: 13,
                      fontWeight: "700",
                      textShadowColor: "rgba(0,0,0,0.8)",
                      textShadowOffset: { width: 0, height: 1 },
                      textShadowRadius: 4,
                    }}
                  >
                    {author?.username}
                  </Text>
                  {location ? (
                    <Text
                      numberOfLines={1}
                      style={{
                        color: "rgba(255,255,255,0.85)",
                        fontSize: 10,
                        textShadowColor: "rgba(0,0,0,0.8)",
                        textShadowOffset: { width: 0, height: 1 },
                        textShadowRadius: 3,
                      }}
                    >
                      {location}
                    </Text>
                  ) : null}
                  {isNSFW ? <Text style={{ fontSize: 10 }}>😈</Text> : null}
                </View>
              </DVNTLiquidGlass>
            </Pressable>

            {/* TOP-RIGHT: Carousel dots (multi-image) */}
            {hasMultipleMedia && (
              <View
                style={{
                  position: "absolute",
                  top: 18,
                  right: 82,
                  zIndex: 50,
                }}
                pointerEvents="none"
              >
                <CarouselDots count={media.length} current={currentSlide} />
              </View>
            )}

            {/* TOP-RIGHT: More menu */}
            <Pressable
              onPress={handleMorePress}
              style={{ position: "absolute", top: 0, right: 0, zIndex: 50 }}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="More options"
            >
              <DVNTLiquidGlassIconButton size={44} style={{ borderRadius: 12 }}>
                <MoreHorizontal size={26} color="#fff" />
              </DVNTLiquidGlassIconButton>
            </Pressable>

            {/* Video: mute button top-right (above more menu area, or swap position) */}
            {hasPlayableVideo && (
              <Pressable
                onPress={toggleMute}
                style={{ position: "absolute", top: 56, right: 12, zIndex: 50 }}
                hitSlop={12}
                accessibilityRole="button"
                accessibilityLabel={isMuted ? "Unmute video" : "Mute video"}
              >
                <DVNTLiquidGlassIconButton size={34}>
                  {isMuted ? (
                    <VolumeX size={15} color="#fff" />
                  ) : (
                    <Volume2 size={15} color="#fff" />
                  )}
                </DVNTLiquidGlassIconButton>
              </Pressable>
            )}

            {/* BOTTOM-LEFT: Social actions pill */}
            <View
              style={{
                position: "absolute",
                bottom: socialBottom,
                left: 12,
                zIndex: 50,
              }}
            >
              <DVNTLiquidGlass paddingH={12} paddingV={9} radius={14}>
                {/* Like */}
                <Pressable
                  onPress={handleLike}
                  disabled={isLikePending}
                  hitSlop={8}
                  style={{ flexDirection: "row", alignItems: "center", gap: 4 }}
                >
                  <Heart
                    size={22}
                    color={hasLiked ? "#FF5BFC" : "#fff"}
                    fill={hasLiked ? "#FF5BFC" : "none"}
                  />
                  <Text
                    style={{
                      color: "#fff",
                      fontSize: 14,
                      fontWeight: "600",
                      textShadowColor: "rgba(0,0,0,0.8)",
                      textShadowOffset: { width: 0, height: 1 },
                      textShadowRadius: 3,
                    }}
                  >
                    {formatLikeCount(likesCount)}
                  </Text>
                </Pressable>

                {/* Divider */}
                <View
                  style={{
                    width: 1,
                    height: 18,
                    backgroundColor: "rgba(255,255,255,0.2)",
                  }}
                />

                {/* Comment */}
                <Pressable
                  hitSlop={8}
                  style={{ flexDirection: "row", alignItems: "center", gap: 4 }}
                  onPressIn={() => id && prefetchComments(id)}
                  onPress={handleCommentsPress}
                >
                  <MessageCircle size={22} color="#fff" />
                  {commentCount > 0 && (
                    <Text
                      style={{
                        color: "#fff",
                        fontSize: 14,
                        fontWeight: "600",
                        textShadowColor: "rgba(0,0,0,0.8)",
                        textShadowOffset: { width: 0, height: 1 },
                        textShadowRadius: 3,
                      }}
                    >
                      {commentCount}
                    </Text>
                  )}
                </Pressable>

                {/* Divider */}
                <View
                  style={{
                    width: 1,
                    height: 18,
                    backgroundColor: "rgba(255,255,255,0.2)",
                  }}
                />

                {/* Share */}
                <Pressable
                  hitSlop={8}
                  onPress={handleSharePress}
                  accessibilityRole="button"
                  accessibilityLabel="Share post"
                >
                  <Send size={22} color="#fff" />
                </Pressable>

                {/* Divider */}
                <View
                  style={{
                    width: 1,
                    height: 18,
                    backgroundColor: "rgba(255,255,255,0.2)",
                  }}
                />

                {/* Bookmark */}
                <Pressable
                  onPress={handleSave}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={isBookmarked ? "Remove bookmark" : "Save post"}
                  accessibilityState={{ selected: isBookmarked }}
                >
                  <Bookmark
                    size={22}
                    color={isBookmarked ? "#3FDCFF" : "#fff"}
                    fill={isBookmarked ? "#3FDCFF" : "none"}
                  />
                </Pressable>

                {/* Timestamp */}
                <View
                  style={{
                    width: 1,
                    height: 18,
                    backgroundColor: "rgba(255,255,255,0.2)",
                  }}
                />
                <Text
                  style={{
                    fontSize: 12,
                    color: "rgba(255,255,255,0.6)",
                    textTransform: "uppercase",
                    textShadowColor: "rgba(0,0,0,0.8)",
                    textShadowOffset: { width: 0, height: 1 },
                    textShadowRadius: 3,
                  }}
                >
                  {timeAgo}
                </Text>
              </DVNTLiquidGlass>
            </View>

            {/* BOTTOM-RIGHT: Expand (video only) */}
            {hasPlayableVideo && (
              <Pressable
                onPress={handleFullscreenToggle}
                style={{
                  position: "absolute",
                  bottom: socialBottom,
                  right: 12,
                  zIndex: 50,
                }}
                hitSlop={12}
              >
                <DVNTLiquidGlassIconButton size={36}>
                  <Maximize2 size={17} color="#fff" />
                </DVNTLiquidGlassIconButton>
              </Pressable>
            )}

            {/* SEEK BAR — always visible for video, 4px from bottom */}
            {hasPlayableVideo && (
              <DVNTSeekBar
                currentTime={videoCurrentTime}
                duration={videoDuration}
                onSeek={handleVideoSeek}
                onSeekEnd={() => {
                  if (isFocused && isActivePost) {
                    safePlay(player, isMountedRef, "FeedPost");
                  }
                }}
                barWidth={cardInnerWidthRef.current - 32}
              />
            )}
          </View>
        ) : null}
      </Article>

      {/* Sheets (CommentsSheet, PostActionSheet, ShareToInboxSheet) rendered at Feed level */}

      {/* Custom fullscreen modal for video */}
      {hasPlayableVideo && isFullscreen && (
        <Modal
          visible
          animationType="fade"
          supportedOrientations={["portrait", "landscape"]}
          statusBarTranslucent
          onRequestClose={handleFullscreenToggle}
        >
          <StatusBar hidden />
          <View style={{ flex: 1, backgroundColor: "#000" }}>
            <Pressable onPress={handleVideoPress} style={{ flex: 1 }}>
              <VideoView
                player={player}
                style={{ flex: 1 }}
                contentFit="cover"
                nativeControls={false}
              />
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
                currentTime={videoCurrentTime}
                duration={videoDuration}
                onSeek={handleVideoSeek}
                onSeekEnd={() => {
                  if (isFocused && isActivePost) {
                    safePlay(player, isMountedRef, "FeedPost");
                  }
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
                  <VolumeX size={16} color="#fff" />
                ) : (
                  <Volume2 size={16} color="#fff" />
                )}
              </DVNTLiquidGlassIconButton>
            </Pressable>
          </View>
        </Modal>
      )}
    </View>
  );
}

export const FeedPost = memo(FeedPostComponent);
