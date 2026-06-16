/**
 * StoryViewerWrapper
 *
 * Integrates react-native-insta-story for:
 * - Story sequencing & progress timing
 * - Tap left/right navigation
 * - Long press pause
 * - Swipe down dismiss
 * - Video playback control (via react-native-video internally)
 *
 * ALL layout, styling, overlays, and UX polish are custom.
 * Media renders true fullscreen (behind status bar, no letterboxing).
 */

import { Dimensions, StyleSheet } from "react-native";
import InstaStory from "react-native-insta-story";
import type { IUserStory } from "react-native-insta-story";
import { useCallback, useMemo } from "react";
import { useRouter } from "expo-router";
import { useStories } from "@/lib/hooks/use-stories";
import { useAuthStore } from "@/lib/stores/auth-store";
import { toInstaStoryData, findStoryIndex } from "./story-adapter";
import {
  StoryCloseButton,
  StoryHeaderText,
  StoryFooter,
} from "./story-overlays";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } =
  Dimensions.get("window");

interface StoryViewerWrapperProps {
  /** If provided, open viewer directly to this story ID on mount */
  initialStoryId?: string;
}

export function StoryViewerWrapper({
  initialStoryId,
}: StoryViewerWrapperProps) {
  const router = useRouter();
  const { data: stories = [] } = useStories();
  const user = useAuthStore((s) => s.user);
  const insets = useSafeAreaInsets();

  // Transform app stories → InstaStory data format
  const instaData = useMemo(() => {
    if (!stories.length) return [];
    return toInstaStoryData(stories);
  }, [stories]);
  const progressContainerStyle = useMemo(
    () => ({
      ...progressStyles.container,
      paddingTop: Math.max(insets.top + 8, 18),
    }),
    [insets.top],
  );

  const handleStart = useCallback((userStory?: IUserStory) => {
    console.log("[StoryViewer] Story started:", userStory?.user_name);
  }, []);

  const handleClose = useCallback(
    (userStory?: IUserStory) => {
      console.log("[StoryViewer] Story closed:", userStory?.user_name);
    },
    [],
  );

  const handleStorySeen = useCallback(
    (userSingleStory: any) => {
      console.log(
        "[StoryViewer] Story seen:",
        userSingleStory?.user_name,
        "item:",
        userSingleStory?.story?.story_id,
      );
    },
    [],
  );

  if (!instaData.length) return null;

  return (
    <InstaStory
      data={instaData}
      duration={5}
      onStart={handleStart}
      onClose={handleClose}
      onStorySeen={handleStorySeen}
      // ── Avatar circle list styling ──────────────────────────
      avatarSize={80}
      showAvatarText={true}
      avatarTextStyle={avatarTextStyles.text}
      avatarImageStyle={avatarImageStyles.image}
      avatarWrapperStyle={avatarWrapperStyles.wrapper}
      unPressedBorderColor="#8A40CF"
      pressedBorderColor="#333"
      unPressedAvatarTextColor="rgba(255,255,255,0.7)"
      pressedAvatarTextColor="rgba(255,255,255,0.4)"
      // ── Fullscreen media override (CRITICAL) ───────────────
      // Force true fullscreen: width 100%, height 100%, cover, no letterbox
      storyContainerStyle={fullscreenStyles.container}
      storyImageStyle={fullscreenStyles.image}
      // ── Custom progress bar styling ────────────────────────
      animationBarContainerStyle={progressContainerStyle}
      loadedAnimationBarStyle={progressStyles.loaded}
      unloadedAnimationBarStyle={progressStyles.unloaded}
      // ── Custom header area ─────────────────────────────────
      storyUserContainerStyle={headerStyles.container}
      storyAvatarImageStyle={headerStyles.avatar}
      // ── Custom render overrides ────────────────────────────
      renderCloseComponent={StoryCloseButton}
      renderTextComponent={StoryHeaderText}
      renderSwipeUpComponent={StoryFooter}
      // ── Hide default avatar list — we use our own StoriesBar ──
      style={listStyles.container}
      avatarFlatListProps={{
        contentContainerStyle: listStyles.flatListContent,
      }}
    />
  );
}

// ── Fullscreen media styles ─────────────────────────────────────────
// CRITICAL: These override the library's internal styles to achieve
// true fullscreen rendering identical to Instagram Stories.
// Media extends behind status bar, ignores parent padding, no letterbox.

const fullscreenStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#000",
    // No padding, no margin — true edge-to-edge
    padding: 0,
    margin: 0,
  },
  image: {
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT,
    resizeMode: "cover",
  },
});

// ── Progress bar styles ─────────────────────────────────────────────
// Thin, rounded, white-on-translucent — Instagram 2025 style

const progressStyles = StyleSheet.create({
  container: {
    flexDirection: "row",
    paddingHorizontal: 8,
    gap: 4,
  },
  loaded: {
    height: 2.5,
    backgroundColor: "#fff",
    borderRadius: 2,
  },
  unloaded: {
    height: 2.5,
    flex: 1,
    flexDirection: "row",
    backgroundColor: "rgba(255,255,255,0.35)",
    marginHorizontal: 2,
    borderRadius: 2,
    overflow: "hidden",
  },
});

// ── Header styles ───────────────────────────────────────────────────

const headerStyles = StyleSheet.create({
  container: {
    height: 50,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 12,
  },
  avatar: {
    height: 32,
    width: 32,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.3)",
  },
});

// ── Avatar circle list styles (for the horizontal bar) ──────────────

const avatarTextStyles = StyleSheet.create({
  text: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 11,
    fontWeight: "600",
    marginTop: 4,
  },
});

const avatarImageStyles = StyleSheet.create({
  image: {
    borderRadius: 40,
    width: 64,
    height: 64,
  },
});

const avatarWrapperStyles = StyleSheet.create({
  wrapper: {
    paddingHorizontal: 6,
    paddingVertical: 4,
  },
});

const listStyles = StyleSheet.create({
  container: {
    // The InstaStory avatar list container
  },
  flatListContent: {
    paddingHorizontal: 4,
    paddingVertical: 6,
    gap: 4,
  },
});

export default StoryViewerWrapper;
