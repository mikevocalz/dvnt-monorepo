import {
  View,
  Text,
  TextInput,
  Pressable,
  Dimensions,
  Alert,
  ActivityIndicator,
  Platform,
} from "react-native";
import {
  KeyboardController,
  KeyboardProvider,
  KeyboardAvoidingView,
} from "react-native-keyboard-controller";
import { Animated as RNAnimated, Easing } from "react-native";
import { useLocalSearchParams, useRouter, useFocusEffect } from "expo-router";
import { Image } from "expo-image";
import { VideoView, useVideoPlayer } from "expo-video";
import { LinearGradient } from "expo-linear-gradient";
import { X, Send, Eye, Heart, Trash2 } from "lucide-react-native";
import { DVNTLiquidGlass } from "@dvnt/app/components/media/DVNTLiquidGlass";
import { DVNTGifView } from "@dvnt/app/components/media/DVNTGifView";
import * as Haptics from "expo-haptics";
import { useEffect, useCallback, useRef, useState, useMemo } from "react";
import { ErrorBoundary } from "@dvnt/app/components/error-boundary";
import { useQueryClient } from "@tanstack/react-query";
import { screenPrefetch } from "@dvnt/app/lib/prefetch";
import { getOrCreateConversationCached } from "@dvnt/app/lib/hooks/use-conversation-resolution";
import { Debouncer } from "@tanstack/react-pacer";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  cancelAnimation,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import type { SharedValue } from "react-native-reanimated";
import {
  useVideoLifecycle,
  safePlay,
  safePause,
  safeSeek,
  safeGetCurrentTime,
  safeGetDuration,
  cleanupPlayer,
  logVideoHealth,
} from "@dvnt/app/lib/video-lifecycle";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useStoryViewerStore } from "@dvnt/app/lib/stores/comments-store";
import { VideoSeekBar } from "@dvnt/app/components/video-seek-bar";
import {
  useStories,
  useStoryViewerCount,
  useRecordStoryView,
  useDeleteStory,
  storyViewKeys,
} from "@dvnt/app/lib/hooks/use-stories";
import { storyViewsApi } from "@dvnt/app/lib/api/stories";
import { StoryViewersSheet } from "@dvnt/app/components/stories/story-viewers-sheet";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import { messagesApiClient } from "@dvnt/app/lib/api/messages";
import { useUIStore } from "@dvnt/app/lib/stores/ui-store";
import { useStoryViewerScreenStore } from "@dvnt/app/lib/stores/story-viewer-screen-store";
import { normalizeRouteParams } from "@dvnt/app/lib/navigation/route-params";
import {
  loopDetection,
  useRenderLoopDetector,
} from "@dvnt/app/lib/diagnostics/loop-detection";
import { usersApi } from "@dvnt/app/lib/api/users";
import { storyTagsApi, type StoryTag } from "@dvnt/app/lib/api/stories";
import type { Story, StoryAnimatedGifOverlay, StoryOverlay } from "@dvnt/app/lib/types";
import { getImageStickerSourceById } from "@dvnt/app/src/stories-editor/constants";
import {
  getSystemFontWeight,
  shouldUseSystemFontFallback,
} from "@dvnt/app/src/stories-editor/utils/text-support";

const { width, height } = Dimensions.get("window");
const LONG_PRESS_DELAY = 300;

type RGB = { r: number; g: number; b: number };

function clampChannel(value: number) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function parseStoryColor(input?: string | null): RGB | null {
  if (!input) return null;

  const hex = input.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    const raw = hex[1];
    const normalized =
      raw.length === 3
        ? raw
            .split("")
            .map((char) => `${char}${char}`)
            .join("")
        : raw;

    return {
      r: parseInt(normalized.slice(0, 2), 16),
      g: parseInt(normalized.slice(2, 4), 16),
      b: parseInt(normalized.slice(4, 6), 16),
    };
  }

  const rgb = input
    .trim()
    .match(
      /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,\s*[\d.]+\s*)?\)$/i,
    );
  if (!rgb) return null;

  return {
    r: clampChannel(Number(rgb[1])),
    g: clampChannel(Number(rgb[2])),
    b: clampChannel(Number(rgb[3])),
  };
}

function mixStoryColor(base: RGB, target: RGB, amount: number): RGB {
  return {
    r: clampChannel(base.r + (target.r - base.r) * amount),
    g: clampChannel(base.g + (target.g - base.g) * amount),
    b: clampChannel(base.b + (target.b - base.b) * amount),
  };
}

function rgbToHex(color: RGB) {
  return `#${color.r.toString(16).padStart(2, "0")}${color.g
    .toString(16)
    .padStart(2, "0")}${color.b.toString(16).padStart(2, "0")}`;
}

function rgbToRgba(color: RGB, alpha: number) {
  return `rgba(${color.r},${color.g},${color.b},${alpha})`;
}

function buildTextStoryPalette(backgroundColor?: string | null) {
  const base = parseStoryColor(backgroundColor) ?? { r: 91, g: 27, b: 122 };
  const deep = mixStoryColor(base, { r: 8, g: 10, b: 18 }, 0.52);
  const lifted = mixStoryColor(base, { r: 255, g: 255, b: 255 }, 0.18);
  const electric = mixStoryColor(base, { r: 255, g: 91, b: 252 }, 0.46);
  const cyan = mixStoryColor(base, { r: 62, g: 164, b: 229 }, 0.6);

  return {
    background: [rgbToHex(deep), rgbToHex(base), rgbToHex(lifted)] as const,
    card: rgbToRgba(mixStoryColor(base, { r: 6, g: 8, b: 14 }, 0.72), 0.84),
    cardBorder: rgbToRgba(
      mixStoryColor(base, { r: 255, g: 255, b: 255 }, 0.2),
      0.22,
    ),
    innerHighlight: rgbToRgba(
      mixStoryColor(base, { r: 255, g: 255, b: 255 }, 0.36),
      0.12,
    ),
    accent: rgbToHex(electric),
    glowPrimary: rgbToRgba(electric, 0.26),
    glowSecondary: rgbToRgba(cyan, 0.2),
    textShadow: rgbToRgba({ r: 0, g: 0, b: 0 }, 0.35),
  };
}

function TextOnlyStoryViewer({
  item,
  insets,
}: {
  item: {
    text?: string;
    textColor?: string;
    backgroundColor?: string;
  };
  insets: { top: number; bottom: number };
}) {
  const palette = useMemo(
    () => buildTextStoryPalette(item.backgroundColor),
    [item.backgroundColor],
  );
  const content = (item.text || "").trim();
  const usesSystemFont = shouldUseSystemFontFallback(content);
  const lineCount = Math.max(content.split("\n").length, 1);
  const charCount = content.length;
  const fontSize =
    charCount > 180 || lineCount > 5
      ? 34
      : charCount > 120 || lineCount > 4
        ? 40
        : charCount > 72 || lineCount > 3
          ? 48
          : 58;

  return (
    <LinearGradient
      colors={palette.background}
      start={{ x: 0.06, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={{ flex: 1 }}
    >
      <View
        pointerEvents="none"
        style={{
          position: "absolute",
          top: -height * 0.08,
          right: -width * 0.16,
          width: width * 0.7,
          height: width * 0.7,
          borderRadius: 999,
          backgroundColor: palette.glowPrimary,
        }}
      />
      <View
        pointerEvents="none"
        style={{
          position: "absolute",
          bottom: -height * 0.06,
          left: -width * 0.12,
          width: width * 0.64,
          height: width * 0.64,
          borderRadius: 999,
          backgroundColor: palette.glowSecondary,
        }}
      />
      <View
        style={{
          flex: 1,
          justifyContent: "center",
          paddingTop: insets.top + 112,
          paddingBottom: insets.bottom + 112,
          paddingHorizontal: 24,
        }}
      >
        <View
          style={{
            borderRadius: 34,
            borderCurve: "continuous",
            overflow: "hidden",
            backgroundColor: palette.card,
            borderWidth: 1,
            borderColor: palette.cardBorder,
            shadowColor: "#000",
            shadowOffset: { width: 0, height: 18 },
            shadowOpacity: 0.3,
            shadowRadius: 32,
          }}
        >
          <View
            pointerEvents="none"
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              height: 160,
              backgroundColor: palette.innerHighlight,
            }}
          />
          <View
            style={{
              paddingHorizontal: 28,
              paddingVertical: 32,
              minHeight: Math.min(height * 0.44, 440),
              justifyContent: "center",
            }}
          >
            <View
              style={{
                width: 56,
                height: 5,
                borderRadius: 999,
                alignSelf: "center",
                backgroundColor: palette.accent,
                marginBottom: 24,
              }}
            />
            <Text
              style={{
                color: item.textColor || "#FFFFFF",
                fontSize,
                lineHeight: fontSize * 1.16,
                textAlign: "center",
                letterSpacing: -0.8,
                textShadowColor: palette.textShadow,
                textShadowRadius: 18,
                textShadowOffset: { width: 0, height: 10 },
                fontFamily: usesSystemFont ? undefined : "SpaceGrotesk-Bold",
                fontWeight: usesSystemFont ? "800" : undefined,
              }}
            >
              {content || "No text"}
            </Text>
          </View>
        </View>
      </View>
    </LinearGradient>
  );
}

function StoryViewerLoadingState({
  insets,
  label,
}: {
  insets: { top: number; bottom: number };
  label: string;
}) {
  return (
    <LinearGradient
      colors={["#050507", "#101119", "#07070a"]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={{ flex: 1 }}
    >
      <View
        pointerEvents="none"
        style={{
          position: "absolute",
          top: -height * 0.04,
          right: -width * 0.12,
          width: width * 0.58,
          height: width * 0.58,
          borderRadius: 999,
          backgroundColor: "rgba(255,91,252,0.12)",
        }}
      />
      <View
        pointerEvents="none"
        style={{
          position: "absolute",
          bottom: -height * 0.05,
          left: -width * 0.14,
          width: width * 0.62,
          height: width * 0.62,
          borderRadius: 999,
          backgroundColor: "rgba(62,164,229,0.1)",
        }}
      />
      <View
        style={{
          flex: 1,
          justifyContent: "center",
          alignItems: "center",
          paddingTop: insets.top + 24,
          paddingBottom: insets.bottom + 32,
          paddingHorizontal: 28,
        }}
      >
        <View
          style={{
            width: Math.min(width - 48, 360),
            borderRadius: 30,
            borderCurve: "continuous" as any,
            backgroundColor: "rgba(18,18,24,0.9)",
            borderWidth: 1,
            borderColor: "rgba(255,255,255,0.08)",
            paddingHorizontal: 24,
            paddingVertical: 26,
            alignItems: "center",
            shadowColor: "#000",
            shadowOffset: { width: 0, height: 18 },
            shadowOpacity: 0.26,
            shadowRadius: 28,
            gap: 14,
          }}
        >
          <ActivityIndicator color="#FFFFFF" />
          <Text
            style={{
              color: "#FFFFFF",
              fontSize: 18,
              fontWeight: "800",
              letterSpacing: -0.2,
            }}
          >
            {label}
          </Text>
          <Text
            style={{
              color: "rgba(255,255,255,0.68)",
              fontSize: 13,
              lineHeight: 18,
              textAlign: "center",
            }}
          >
            Loading the full story before the viewer appears.
          </Text>
        </View>
      </View>
    </LinearGradient>
  );
}

function ProgressBar({ progress }: { progress: SharedValue<number> }) {
  const animatedStyle = useAnimatedStyle(() => ({
    width: `${progress.value * 100}%`,
    height: "100%",
    backgroundColor: "#fff",
  }));

  return <Animated.View style={animatedStyle} />;
}

function FloatingReactionEmoji({
  emoji,
  onComplete,
}: {
  emoji: string;
  onComplete: () => void;
}) {
  const translateY = useRef(new RNAnimated.Value(0)).current;
  const opacity = useRef(new RNAnimated.Value(1)).current;
  const scale = useRef(new RNAnimated.Value(0.3)).current;
  const translateX = useRef(
    new RNAnimated.Value((Math.random() - 0.5) * 80),
  ).current;

  useRef(
    RNAnimated.parallel([
      RNAnimated.timing(translateY, {
        toValue: -300 - Math.random() * 100,
        duration: 2200,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      RNAnimated.sequence([
        RNAnimated.spring(scale, {
          toValue: 1.3,
          speed: 40,
          bounciness: 12,
          useNativeDriver: true,
        }),
        RNAnimated.timing(scale, {
          toValue: 0.8,
          duration: 1500,
          useNativeDriver: true,
        }),
      ]),
      RNAnimated.timing(opacity, {
        toValue: 0,
        duration: 2200,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start(onComplete),
  ).current;

  return (
    <RNAnimated.Text
      style={{
        position: "absolute",
        bottom: 100,
        right: 30,
        fontSize: 36,
        zIndex: 999,
        opacity,
        transform: [{ translateY }, { translateX }, { scale }],
      }}
    >
      {emoji}
    </RNAnimated.Text>
  );
}

function StoryAnimatedGifOverlays({
  overlays,
}: {
  overlays: StoryAnimatedGifOverlay[];
}) {
  if (overlays.length === 0) return null;

  return (
    <View
      pointerEvents="none"
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
      }}
    >
      {overlays.map((overlay) => {
        const size = width * overlay.sizeRatio * overlay.scale;
        const left = width * overlay.x - size / 2;
        const top = height * overlay.y - size / 2;

        return (
          <View
            key={overlay.id}
            style={{
              position: "absolute",
              left,
              top,
              width: size,
              height: size,
              transform: [{ rotate: `${overlay.rotation}deg` }],
            }}
          >
            <DVNTGifView
              uri={overlay.url}
              width="100%"
              height="100%"
              contentFit="contain"
            />
          </View>
        );
      })}
    </View>
  );
}

function StoryOverlayLayer({ overlays }: { overlays: StoryOverlay[] }) {
  if (overlays.length === 0) return null;

  return (
    <View
      pointerEvents="none"
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
      }}
    >
      {overlays.map((overlay) => {
        if (overlay.type === "animated_gif") {
          const size = width * overlay.sizeRatio * overlay.scale;
          const left = width * overlay.x - size / 2;
          const top = height * overlay.y - size / 2;

          return (
            <View
              key={overlay.id}
              style={{
                position: "absolute",
                left,
                top,
                width: size,
                height: size,
                opacity: overlay.opacity ?? 1,
                transform: [{ rotate: `${overlay.rotation}deg` }],
              }}
            >
              <DVNTGifView
                uri={overlay.url}
                width="100%"
                height="100%"
                contentFit="contain"
              />
            </View>
          );
        }

        if (overlay.type === "emoji") {
          const size = width * overlay.sizeRatio * overlay.scale;
          const left = width * overlay.x - size / 2;
          const top = height * overlay.y - size / 2;

          return (
            <Text
              key={overlay.id}
              style={{
                position: "absolute",
                left,
                top,
                width: size,
                height: size,
                fontSize: size,
                textAlign: "center",
                opacity: overlay.opacity ?? 1,
                transform: [{ rotate: `${overlay.rotation}deg` }],
              }}
            >
              {overlay.emoji}
            </Text>
          );
        }

        if (overlay.type === "text") {
          const maxWidth = width * overlay.maxWidthRatio;
          const fontSize = Math.max(
            width * overlay.fontSizeRatio * overlay.scale,
            18,
          );
          const prefersSystemFont = shouldUseSystemFontFallback(
            overlay.content,
          );
          return (
            <View
              key={overlay.id}
              style={{
                position: "absolute",
                left: width * overlay.x - maxWidth / 2,
                top: height * overlay.y - fontSize,
                width: maxWidth,
                opacity: overlay.opacity ?? 1,
                transform: [{ rotate: `${overlay.rotation}deg` }],
              }}
            >
              <Text
                style={{
                  color: overlay.color,
                  backgroundColor: overlay.backgroundColor || "transparent",
                  fontSize,
                  lineHeight: fontSize * 1.14,
                  fontWeight: prefersSystemFont
                    ? getSystemFontWeight(overlay.fontFamily)
                    : "700",
                  textAlign: overlay.textAlign || "center",
                  fontFamily: prefersSystemFont
                    ? undefined
                    : overlay.fontFamily || undefined,
                }}
              >
                {overlay.content}
              </Text>
            </View>
          );
        }

        const size = width * overlay.sizeRatio * overlay.scale;
        const left = width * overlay.x - size / 2;
        const top = height * overlay.y - size / 2;
        const assetSource =
          overlay.source === "asset" && overlay.assetId
            ? getImageStickerSourceById(overlay.assetId)
            : null;
        const imageSource =
          overlay.source === "url" ? { uri: overlay.url } : assetSource;

        if (!imageSource) return null;

        return (
          <View
            key={overlay.id}
            style={{
              position: "absolute",
              left,
              top,
              width: size,
              height: size,
              opacity: overlay.opacity ?? 1,
              transform: [{ rotate: `${overlay.rotation}deg` }],
            }}
          >
            <Image
              source={imageSource}
              style={{ width: "100%", height: "100%" }}
              contentFit="contain"
            />
          </View>
        );
      })}
    </View>
  );
}

function StoryViewerScreenContent() {
  // DEV-only loop detection
  useRenderLoopDetector("StoryViewer");

  const rawParams = useLocalSearchParams<{
    id: string;
    username?: string;
    demoText?: string;
    demoBackground?: string;
    demoTextColor?: string;
    demoImageUrl?: string;
  }>();
  const router = useRouter();
  const queryClient = useQueryClient();

  // FIX: Normalize params once to prevent string|string[] instability loops
  const normalizedParams = useMemo(
    () => normalizeRouteParams(rawParams),
    [rawParams.id, rawParams.username],
  );
  const id = normalizedParams.id;
  const usernameParam = normalizedParams.username;
  const demoTextParam =
    typeof rawParams.demoText === "string" ? rawParams.demoText : undefined;
  const demoBackgroundParam =
    typeof rawParams.demoBackground === "string"
      ? rawParams.demoBackground
      : undefined;
  const demoTextColorParam =
    typeof rawParams.demoTextColor === "string"
      ? rawParams.demoTextColor
      : undefined;
  const demoImageUrlParam =
    typeof rawParams.demoImageUrl === "string"
      ? rawParams.demoImageUrl
      : undefined;

  loopDetection.log("StoryViewer", "mount", { id, username: usernameParam });
  const {
    currentStoryId,
    currentItemIndex,
    setCurrentStoryId,
    setCurrentItemIndex,
  } = useStoryViewerStore();
  const insets = useSafeAreaInsets();
  const [showVideoPoster, setShowVideoPoster] = useState(true);
  const storyChromeTopInset = Math.max(insets.top + 10, 22);
  const touchZonesTop = insets.top + 90;

  const progress = useSharedValue(0);

  // FIX: Replace useState with Zustand to comply with project mandate
  const {
    showSeekBar,
    setShowSeekBar,
    videoCurrentTime,
    setVideoCurrentTime,
    videoDuration,
    setVideoDuration,
    replyText,
    setReplyText,
    isSendingReply,
    setIsSendingReply,
    isInputFocused,
    setIsInputFocused,
    resolvedUserId,
    setResolvedUserId,
    storyTags,
    setStoryTags,
    showTags,
    setShowTags,
    floatingEmojis,
    addFloatingEmoji,
    removeFloatingEmoji,
    resetStoryViewerScreen,
  } = useStoryViewerScreenStore();

  const emojiCounter = useRef(0);

  const REACTION_EMOJIS = ["❤️", "🔥", "😂", "😍", "👏", "😮", "😈"];
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isPaused = useRef(false);
  const hasAdvanced = useRef(false);
  const handleNextRef = useRef<() => void>(() => {});
  const itemDurationRef = useRef(5000);
  const longPressActivated = useRef(false);

  // CRITICAL: Video lifecycle management to prevent crashes
  const {
    isMountedRef,
    isExitingRef,
    markExiting,
    safeTimeout,
    isSafeToOperate,
  } = useVideoLifecycle("StoryViewer", currentStoryId);

  // Auth and utilities
  const { user: currentUser } = useAuthStore();
  const showToast = useUIStore((s) => s.showToast);

  // Fetch real stories from API
  const { data: storiesData = [], isLoading, isFetching } = useStories();

  const devDemoStories = useMemo<Story[]>(() => {
    if (!__DEV__ || (!demoTextParam && !demoImageUrlParam)) return [];

    return [
      {
        id: String(id || "dev-story-group-text"),
        userId: "dev-demo-viewer",
        username: usernameParam || "dev-demo",
        avatar: "",
        hasStory: true,
        isViewed: false,
        isYou: false,
        items: [
          demoImageUrlParam
            ? {
                id: "dev-story-item-image",
                type: "image",
                url: demoImageUrlParam,
                duration: 5000,
                storyOverlays: [],
                animatedGifOverlays: [],
                visibility: "public",
              }
            : {
                id: "dev-story-item-text",
                type: "text",
                text: demoTextParam,
                textColor: demoTextColorParam || "#FFF8FE",
                backgroundColor: demoBackgroundParam || "#5b1b7a",
                duration: 5000,
                storyOverlays: [],
                animatedGifOverlays: [],
                visibility: "public",
              },
        ],
      },
    ];
  }, [
    demoBackgroundParam,
    demoImageUrlParam,
    demoTextColorParam,
    demoTextParam,
    id,
    usernameParam,
  ]);

  useEffect(() => {
    if (id) {
      setCurrentStoryId(id);
    }
    // Only sync from URL param on mount / route change.
    // Do NOT include currentStoryId — internal navigation (goToNextUser)
    // updates it and must not be overwritten by this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, setCurrentStoryId]);

  // Filter stories that have content
  const availableStories = (
    devDemoStories.length ? devDemoStories : storiesData
  ).filter((s) => s.items && s.items.length > 0);
  // Use loose equality to handle string/number comparison (URL params are strings, API IDs may be numbers)
  let currentStoryIndex = availableStories.findIndex(
    (s) => String(s.id) === String(currentStoryId),
  );

  // Fallback: if storyId didn't match (e.g. stale ID from chat story-reply metadata),
  // try finding by username param. Group IDs change when new stories are posted.
  const fallbackUsername =
    usernameParam ||
    (String(currentStoryId || id).startsWith("temp-")
      ? currentUser?.username
      : undefined);

  if (currentStoryIndex === -1 && fallbackUsername) {
    currentStoryIndex = availableStories.findIndex(
      (s) => s.username?.toLowerCase() === fallbackUsername.toLowerCase(),
    );
    if (currentStoryIndex !== -1) {
      const found = availableStories[currentStoryIndex];
      console.log(
        `[StoryViewer] ID miss, found by username '${fallbackUsername}' → id=${found.id}`,
      );
      setCurrentStoryId(String(found.id));
    }
  }

  const story = availableStories[currentStoryIndex];
  const currentItem = story?.items?.[currentItemIndex];

  // Debug story lookup
  useEffect(() => {
    console.log("[StoryViewer] Story lookup:", {
      urlId: id,
      currentStoryId,
      availableStoriesCount: availableStories.length,
      availableStoryIds: availableStories.map((s) => s.id),
      foundIndex: currentStoryIndex,
      hasStory: !!story,
      hasItems: story?.items?.length || 0,
      userId: story?.userId,
      username: story?.username,
    });
  }, [id, currentStoryId, availableStories.length, currentStoryIndex, story]);

  // If story has username but no userId, look it up
  // CRITICAL FIX: Clear resolvedUserId eagerly on every story change to prevent
  // stale IDs from a previous story author being used for replies/reactions.
  useEffect(() => {
    if (story?.userId) {
      // Sync path — userId available immediately, no stale window
      setResolvedUserId(story.userId);
    } else if (story?.username) {
      // Async path — clear first so replies are blocked during lookup
      setResolvedUserId(null);
      const username = story.username;
      console.log("[StoryViewer] Looking up userId for username:", username);
      usersApi
        .getProfileByUsername(username)
        .then((result: any) => {
          if (result?.id) {
            console.log("[StoryViewer] Found userId:", result.id);
            setResolvedUserId(result.id);
          } else {
            console.warn(
              "[StoryViewer] User not found for username:",
              username,
            );
          }
        })
        .catch((error: any) => {
          console.error("[StoryViewer] Error looking up userId:", error);
        });
    } else {
      setResolvedUserId(null);
    }
  }, [story?.userId, story?.username]);

  // Fetch tags for current story item
  useEffect(() => {
    if (!currentItem?.id || !/^\d+$/.test(String(currentItem.id))) {
      setStoryTags([]);
      return;
    }
    storyTagsApi
      .getTagsForStory(String(currentItem.id))
      .then((tags) => setStoryTags(tags as any))
      .catch(() => setStoryTags([]));
  }, [currentItem?.id]);

  const hasNextUser = currentStoryIndex < availableStories.length - 1;
  const hasPrevUser = currentStoryIndex > 0;

  const isVideo = currentItem?.type === "video";
  const isImage = currentItem?.type === "image" || currentItem?.type === "gif";
  const storyOverlays = useMemo<StoryOverlay[]>(
    () =>
      currentItem?.storyOverlays?.length
        ? currentItem.storyOverlays
        : (currentItem?.animatedGifOverlays || []).map(
            (overlay: StoryAnimatedGifOverlay) => ({
              ...overlay,
              type: "animated_gif" as const,
            }),
          ),
    [currentItem?.animatedGifOverlays, currentItem?.storyOverlays],
  );
  const animatedGifOverlays = useMemo(
    () =>
      storyOverlays
        .filter((overlay) => overlay.type === "animated_gif")
        .map((overlay) => ({
          id: overlay.id,
          url: overlay.url,
          x: overlay.x,
          y: overlay.y,
          sizeRatio: overlay.sizeRatio,
          scale: overlay.scale,
          rotation: overlay.rotation,
        })),
    [storyOverlays],
  );
  const hasAnimatedContent =
    currentItem?.type === "gif" || animatedGifOverlays.length > 0;

  // Validate video URL - must be valid HTTP/HTTPS URL
  const videoUrl = useMemo(() => {
    if (isVideo && currentItem?.url) {
      const url = currentItem.url;
      // Only use valid HTTP/HTTPS URLs
      if (url && (url.startsWith("http://") || url.startsWith("https://"))) {
        return url;
      }
    }
    return "";
  }, [isVideo, currentItem?.url]);

  useEffect(() => {
    if (!isVideo) {
      setShowVideoPoster(false);
      return;
    }
    setShowVideoPoster(true);
  }, [isVideo, currentItem?.id, videoUrl]);

  // Debug logging for story items
  useEffect(() => {
    if (currentItem) {
      console.log("[StoryViewer] Current item:", {
        type: currentItem.type,
        url: currentItem.url,
        hasUrl: !!currentItem.url,
        isValidUrl: currentItem.url
          ? currentItem.url.startsWith("http://") ||
            currentItem.url.startsWith("https://")
          : false,
        isImage,
        isVideo,
      });
    }
  }, [currentItem, isImage, isVideo]);

  const player = useVideoPlayer(videoUrl, (player) => {
    if (player && videoUrl) {
      try {
        player.loop = false;
        player.muted = false;
        // Don't play immediately in callback - wait for VideoView to mount
      } catch (error) {
        console.error("[StoryViewer] Error configuring player:", error);
      }
    }
  });

  // Wrapper function that calls the ref - this ensures we always use the latest handleNext
  const callHandleNext = useCallback(() => {
    handleNextRef.current();
  }, []);

  // Play video when it's ready and VideoView is mounted
  useEffect(() => {
    if (!isVideo || !player || !videoUrl) return;
    if (!isSafeToOperate()) return;
    if (isPaused.current) return;

    // Small delay to ensure VideoView is mounted
    const playTimer = safeTimeout(() => {
      if (isSafeToOperate() && !isPaused.current) {
        logVideoHealth("StoryViewer", "Playing video", {
          videoUrl: videoUrl.slice(0, 50),
        });
        safeSeek(player, isMountedRef, 0, "StoryViewer");
        safePlay(player, isMountedRef, "StoryViewer");
      }
    }, 100);

    return () => clearTimeout(playTimer);
  }, [videoUrl, isVideo, player, isSafeToOperate, safeTimeout, isMountedRef]);

  useEffect(() => {
    if (!isVideo || !player || !videoUrl) return;

    const interval = setInterval(() => {
      if (isSafeToOperate()) {
        const currentTime = safeGetCurrentTime(
          player,
          isMountedRef,
          "StoryViewer",
        );
        const duration = safeGetDuration(player, isMountedRef, "StoryViewer");
        setVideoCurrentTime(currentTime);
        setVideoDuration(duration);

        // Update progress bar based on video playback
        if (duration > 0) {
          const progressValue = Math.min(currentTime / duration, 1);
          progress.value = progressValue;

          // Detect video end and auto-advance
          if (
            currentTime >= duration - 0.3 &&
            duration > 0.5 &&
            !hasAdvanced.current &&
            !isPaused.current
          ) {
            callHandleNext();
          }
        }
      }
    }, 100);

    return () => clearInterval(interval);
  }, [
    isVideo,
    player,
    videoUrl,
    progress,
    isSafeToOperate,
    isMountedRef,
    callHandleNext,
  ]);

  const handleLongPressStart = useCallback(() => {
    if (!isSafeToOperate()) return;
    longPressTimer.current = setTimeout(() => {
      longPressTimer.current = null;
      longPressActivated.current = true;
      isPaused.current = true;
      if (isVideo) {
        setShowSeekBar(true);
        safePause(player, isMountedRef, "StoryViewer");
      } else {
        cancelAnimation(progress);
      }
    }, LONG_PRESS_DELAY);
  }, [isVideo, player, progress, isSafeToOperate, isMountedRef]);

  const handleLongPressEnd = useCallback(() => {
    if (!longPressActivated.current) return;
    longPressActivated.current = false;
    isPaused.current = false;
    if (isVideo) {
      if (showSeekBar) setShowSeekBar(false);
      if (isSafeToOperate()) safePlay(player, isMountedRef, "StoryViewer");
    } else if (isSafeToOperate()) {
      const remaining = (1 - progress.value) * itemDurationRef.current;
      if (remaining > 0) {
        progress.value = withTiming(1, { duration: remaining }, (finished) => {
          if (finished && !hasAdvanced.current && isMountedRef.current && !isExitingRef.current) {
            scheduleOnRN(callHandleNext);
          }
        });
      }
    }
  }, [showSeekBar, isVideo, player, progress, isSafeToOperate, isMountedRef, isExitingRef, callHandleNext]);

  const handleSeek = useCallback(
    (time: number) => {
      safeSeek(player, isMountedRef, time, "StoryViewer");
    },
    [player, isMountedRef],
  );

  // Cleanup player when it changes (e.g. switching between image/video items)
  // Do NOT call markExiting() here — that would poison isSafeToOperate() when
  // switching items within the same user's stories (currentStoryId unchanged).
  useEffect(() => {
    return () => {
      cancelAnimation(progress);
      cleanupPlayer(player, "StoryViewer");
    };
  }, [player, progress]);

  useFocusEffect(
    useCallback(() => {
      // Play video when screen is focused
      if (
        isVideo &&
        player &&
        videoUrl &&
        isSafeToOperate() &&
        !isPaused.current
      ) {
        const focusTimer = setTimeout(() => {
          if (isSafeToOperate()) {
            safePlay(player, isMountedRef, "StoryViewer");
          }
        }, 150);
        return () => clearTimeout(focusTimer);
      }

      return () => {
        if (isVideo && isSafeToOperate()) {
          safePause(player, isMountedRef, "StoryViewer");
        }
      };
    }, [player, isVideo, videoUrl, isSafeToOperate, isMountedRef]),
  );

  useEffect(() => {
    if (!currentItem || !currentStoryId) return;

    // Don't start animation if already navigating away
    if (!isSafeToOperate()) return;

    // Reset progress for new item
    progress.value = 0;
    hasAdvanced.current = false;

    logVideoHealth("StoryViewer", "Starting animation", {
      currentItemIndex,
      currentStoryId,
      isVideo,
    });

    // For images, use the item duration or default 5 seconds
    // For videos, the video end detection will handle advancement
    const duration = isVideo ? 30000 : currentItem.duration || 5000; // Longer timeout for video as backup
    itemDurationRef.current = duration;

    // Small delay to ensure component is mounted
    const timer = setTimeout(() => {
      // Don't start if already exiting
      if (!isSafeToOperate()) return;

      // Animate progress bar - use callHandleNext which reads from ref to avoid stale closures
      if (!isVideo) {
        // For images, animate progress bar
        progress.value = withTiming(1, { duration }, (finished) => {
          if (
            finished &&
            !hasAdvanced.current &&
            isMountedRef.current &&
            !isExitingRef.current
          ) {
            // Do NOT set hasAdvanced here — handleNext sets it itself.
            // Setting it here would cause handleNext's guard to block the call.
            scheduleOnRN(callHandleNext);
          }
        });
      } else {
        // For videos, progress bar will be synced with video playback time in the video tracking effect
        // Start at 0, it will update as video plays
        progress.value = 0;
      }
    }, 50);

    return () => {
      clearTimeout(timer);
      cancelAnimation(progress);
      progress.value = 0;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    currentItemIndex,
    currentStoryId,
    isVideo,
    callHandleNext,
    isSafeToOperate,
    isMountedRef,
    isExitingRef,
  ]);

  const goToNextUser = useCallback(() => {
    if (currentStoryIndex < availableStories.length - 1) {
      const nextStory = availableStories[currentStoryIndex + 1];
      // Cancel running animation before switching to prevent stale callbacks
      cancelAnimation(progress);
      // Update state instead of navigating - this keeps the viewer open
      setCurrentItemIndex(0);
      setCurrentStoryId(String(nextStory.id));
      progress.value = 0;
      hasAdvanced.current = false;
    }
  }, [
    currentStoryIndex,
    availableStories,
    setCurrentItemIndex,
    setCurrentStoryId,
    progress,
    cancelAnimation,
  ]);

  const goToPrevUser = useCallback(() => {
    if (currentStoryIndex > 0) {
      const prevStory = availableStories[currentStoryIndex - 1];
      const prevStoryItemsCount = prevStory?.items?.length || 0;
      // Cancel running animation before switching to prevent stale callbacks
      cancelAnimation(progress);
      // Update state instead of navigating - this keeps the viewer open
      setCurrentItemIndex(Math.max(0, prevStoryItemsCount - 1));
      setCurrentStoryId(String(prevStory.id));
      progress.value = 0;
      hasAdvanced.current = false;
    }
  }, [
    currentStoryIndex,
    availableStories,
    setCurrentItemIndex,
    setCurrentStoryId,
    progress,
    cancelAnimation,
  ]);

  // Check if viewing own story (don't show reply input for own story)
  // Compare by username (case-insensitive) since IDs may not match between auth systems
  const isOwnStory =
    story?.username?.toLowerCase() === currentUser?.username?.toLowerCase();

  // FIX: Replace useState with Zustand
  const { showViewersSheet, setShowViewersSheet } = useStoryViewerScreenStore();
  const currentItemId = currentItem?.id;
  // story_views.story_id points to the concrete stories row for the
  // currently visible item, not the grouped author-level story id.
  const viewableStoryId = currentItemId ? String(currentItemId) : undefined;
  const persistedStoryItemId =
    viewableStoryId && /^\d+$/.test(viewableStoryId)
      ? viewableStoryId
      : undefined;
  const {
    data: viewerCount,
    isLoading: viewerCountLoading,
    isFetching: viewerCountFetching,
  } = useStoryViewerCount(isOwnStory ? persistedStoryItemId : undefined);

  // Delete story mutation
  const deleteStoryMutation = useDeleteStory();

  const handleDeleteStory = useCallback(() => {
    if (!viewableStoryId) return;
    isPaused.current = true;
    cancelAnimation(progress);
    try {
      player?.pause();
    } catch {}

    Alert.alert(
      "Delete Story",
      "This story will be permanently deleted. This action cannot be undone.",
      [
        {
          text: "Cancel",
          style: "cancel",
          onPress: () => {
            isPaused.current = false;
            if (isSafeToOperate()) {
              safePlay(player, isMountedRef, "StoryViewer");
            }
          },
        },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            deleteStoryMutation.mutate(viewableStoryId, {
              onSuccess: () => {
                showToast("success", "Deleted", "Story deleted");
                markExiting();
                if (router.canDismiss()) {
                  router.dismiss();
                } else {
                  router.back();
                }
              },
              onError: (err: any) => {
                showToast(
                  "error",
                  "Error",
                  err?.message || "Failed to delete story",
                );
                isPaused.current = false;
              },
            });
          },
        },
      ],
    );
  }, [
    viewableStoryId,
    player,
    progress,
    cancelAnimation,
    isSafeToOperate,
    isMountedRef,
    markExiting,
    router,
    deleteStoryMutation,
    showToast,
  ]);

  // Record view when viewing someone else's story (once per story parent).
  // Uses a 500ms debounce to avoid recording flicker-views (e.g. fast swipe past).
  // The Set prevents duplicate calls for the same story within this session.
  const recordView = useRecordStoryView();
  const recordedViewsRef = useRef<Set<string>>(new Set());
  const viewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Clear any pending timer from previous story
    if (viewTimerRef.current) {
      clearTimeout(viewTimerRef.current);
      viewTimerRef.current = null;
    }

    if (!persistedStoryItemId || isOwnStory) return;
    if (recordedViewsRef.current.has(persistedStoryItemId)) {
      if (__DEV__) {
        console.log(
          `[StoryViewer] View already recorded for story ${persistedStoryItemId}, skipping`,
        );
      }
      return;
    }

    // Debounce: wait 500ms before recording to ensure user actually viewed the story
    const capturedId = persistedStoryItemId;
    viewTimerRef.current = setTimeout(() => {
      if (__DEV__) {
        console.log(
          `[StoryViewer] Recording view for story ${capturedId} after debounce`,
        );
      }
      recordedViewsRef.current.add(capturedId);
      recordView.mutate(capturedId);
    }, 500);

    return () => {
      if (viewTimerRef.current) {
        clearTimeout(viewTimerRef.current);
        viewTimerRef.current = null;
      }
    };
  }, [persistedStoryItemId, isOwnStory]);

  const handleNext = useCallback(() => {
    if (!story || !story.items) return;
    if (!isSafeToOperate()) return; // Prevent multiple calls
    if (showViewersSheet) return; // Don't advance while viewers sheet is open

    // Prevent double calls - set flag immediately
    if (hasAdvanced.current) {
      logVideoHealth(
        "StoryViewer",
        "Already advanced, ignoring duplicate call",
      );
      return;
    }
    hasAdvanced.current = true;

    logVideoHealth("StoryViewer", "handleNext called", {
      currentItemIndex,
      storyItemsLength: story.items.length,
      currentStoryIndex,
      availableStoriesLength: availableStories.length,
    });

    // Cancel any ongoing animations
    cancelAnimation(progress);

    if (currentItemIndex < story.items.length - 1) {
      // Next story item for current user
      logVideoHealth("StoryViewer", "Moving to next item");
      setCurrentItemIndex(currentItemIndex + 1);
      // Flag will be reset in useEffect when item changes
    } else if (currentStoryIndex < availableStories.length - 1) {
      // Move to next user's stories
      logVideoHealth("StoryViewer", "Moving to next user");
      goToNextUser();
      // Flag will be reset in goToNextUser
    } else {
      // No more stories, exit
      logVideoHealth("StoryViewer", "No more stories, exiting");
      markExiting();
      cancelAnimation(progress);
      router.back();
    }
  }, [
    story,
    currentItemIndex,
    currentStoryIndex,
    availableStories,
    setCurrentItemIndex,
    goToNextUser,
    router,
    progress,
    isSafeToOperate,
    markExiting,
    showViewersSheet,
  ]);

  // Keep ref updated with latest handleNext
  useEffect(() => {
    handleNextRef.current = handleNext;
  }, [handleNext]);

  const handlePrev = useCallback(() => {
    if (currentItemIndex > 0) {
      // Previous story item for current user
      setCurrentItemIndex(currentItemIndex - 1);
    } else if (currentStoryIndex > 0) {
      // Move to previous user's last story
      goToPrevUser();
    }
  }, [currentItemIndex, currentStoryIndex, setCurrentItemIndex, goToPrevUser]);

  // Press-out handlers for touch zones: short tap = navigate, long press release = resume
  const handlePrevPressOut = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
      handlePrev();
    } else if (longPressActivated.current) {
      handleLongPressEnd();
    }
  }, [handlePrev, handleLongPressEnd]);

  const handleNextPressOut = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
      handleNext();
    } else if (longPressActivated.current) {
      handleLongPressEnd();
    }
  }, [handleNext, handleLongPressEnd]);

  // Reset flags when item changes
  useEffect(() => {
    // Small delay to prevent race conditions
    const timer = setTimeout(() => {
      hasAdvanced.current = false;
    }, 100);
    // Don't reset isExiting or hasNavigatedAway here - those are permanent for the session
    return () => clearTimeout(timer);
  }, [currentItemIndex, currentStoryId]);

  // Pause animation when input is focused
  useEffect(() => {
    if (isInputFocused) {
      isPaused.current = true;
      cancelAnimation(progress);
      safePause(player, isMountedRef, "StoryViewer");
    } else {
      isPaused.current = false;
      if (isSafeToOperate()) {
        safePlay(player, isMountedRef, "StoryViewer");
      }
    }
  }, [isInputFocused, player, progress, isMountedRef, isSafeToOperate]);

  // Refs for latest values — avoids stale closures in the debouncer callback
  const storyRef = useRef(story);
  const currentItemIndexRef = useRef(currentItemIndex);
  const resolvedUserIdRef = useRef(resolvedUserId);
  storyRef.current = story;
  currentItemIndexRef.current = currentItemIndex;
  resolvedUserIdRef.current = resolvedUserId;

  // Send story emoji reaction as DM — debounced via TanStack Debouncer
  const reactionDebouncer = useRef(
    new Debouncer(
      async (emoji: string) => {
        try {
          const userId = resolvedUserIdRef.current;
          const s = storyRef.current;
          const idx = currentItemIndexRef.current;
          if (!userId || !s) return;

          // Use cached conversation resolution
          const conversationId = await getOrCreateConversationCached(
            queryClient,
            userId,
          );
          if (!conversationId) return;

          const item = s.items?.[idx];
          const previewUrl =
            item?.type === "video"
              ? item?.thumbnail || item?.url || ""
              : item?.url || "";

          await messagesApiClient.sendMessage({
            conversationId,
            content: emoji,
            metadata: {
              type: "story_reaction",
              storyId: s.id || "",
              storyMediaUrl: previewUrl,
              storyUsername: s.username || "",
              storyAvatar: s.avatar || "",
              reactionEmoji: emoji,
              storyExpiresAt: new Date(
                Date.now() + 24 * 60 * 60 * 1000,
              ).toISOString(),
            },
          });

          console.log("[StoryViewer] Reaction sent:", emoji);
        } catch (error: any) {
          console.error(
            "[StoryViewer] Reaction error:",
            error?.message || error,
          );
        }
      },
      { wait: 1500 },
    ),
  ).current;

  const handleQuickReaction = useCallback(
    (emoji: string) => {
      loopDetection.log("StoryViewer", "reaction:quick", { emoji });
      if (!story || !resolvedUserId || isOwnStory) return;
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      const id = emojiCounter.current++;
      addFloatingEmoji({ id, emoji });
      reactionDebouncer.maybeExecute(emoji);
    },
    [story, resolvedUserId, isOwnStory, reactionDebouncer, addFloatingEmoji],
  );

  // Send story reply as DM
  const handleSendReply = useCallback(async () => {
    if (!replyText.trim() || !story || isSendingReply) return;
    if (isOwnStory) {
      showToast("info", "Info", "You can't reply to your own story");
      return;
    }

    if (!resolvedUserId) {
      console.error("[StoryViewer] No resolved userId for story:", story);
      showToast("error", "Error", "Story data incomplete. Cannot send reply.");
      return;
    }

    setIsSendingReply(true);
    KeyboardController.dismiss();

    try {
      console.log("[StoryViewer] Sending reply to userId:", resolvedUserId);
      // Get or create conversation with story owner (cached)
      const conversationId = await getOrCreateConversationCached(
        queryClient,
        resolvedUserId,
      );

      if (!conversationId) {
        console.error("[StoryViewer] Failed to get/create conversation");
        showToast("error", "Error", "Could not start conversation");
        setIsSendingReply(false);
        return;
      }

      // Send reply with story context as metadata for StoryReplyBubble rendering
      const currentItem = story.items?.[currentItemIndex];
      // For video stories, use thumbnail if available for the preview image
      const previewUrl =
        currentItem?.type === "video"
          ? currentItem?.thumbnail || currentItem?.url || ""
          : currentItem?.url || "";
      const message = await messagesApiClient.sendMessage({
        conversationId: conversationId,
        content: replyText.trim(),
        metadata: {
          type: "story_reply",
          storyId: story.id || "",
          storyMediaUrl: previewUrl,
          storyUsername: story.username || "",
          storyAvatar: story.avatar || "",
          // Story expires 24h after creation — pass expiry so chat can show/hide preview
          storyExpiresAt: new Date(
            Date.now() + 24 * 60 * 60 * 1000,
          ).toISOString(),
        },
      });

      console.log("[StoryViewer] Reply sent successfully");
      showToast("success", "Sent", "Reply sent to their messages");
      setReplyText("");
    } catch (error: any) {
      console.error("[StoryViewer] Reply error:", error?.message || error);
      const errorMsg =
        error?.message || error?.error?.message || "Failed to send reply";
      showToast("error", "Error", errorMsg);
    } finally {
      setIsSendingReply(false);
      setIsInputFocused(false);
    }
  }, [replyText, story, isSendingReply, isOwnStory, showToast, resolvedUserId]);

  // Video end detection - auto-advance when video finishes
  useEffect(() => {
    if (!isVideo || !player || videoDuration === 0) return;
    if (!isSafeToOperate()) return;
    if (isPaused.current) return;
    if (hasAdvanced.current) return; // Already advanced

    // Check if video has ended (within 0.2s of end) and we haven't already advanced
    if (videoCurrentTime >= videoDuration - 0.2 && videoDuration > 0) {
      logVideoHealth("StoryViewer", "Video ended, advancing", {
        videoCurrentTime,
        videoDuration,
      });
      // Set flag to prevent this effect from re-firing on next 100ms tick
      hasAdvanced.current = true;
      // Cancel the progress animation since video ended naturally
      cancelAnimation(progress);
      // Small delay to ensure state is consistent
      safeTimeout(() => {
        // Reset flag right before calling so handleNext's guard doesn't block
        hasAdvanced.current = false;
        callHandleNext();
      }, 50);
    }
  }, [
    isVideo,
    player,
    videoCurrentTime,
    videoDuration,
    callHandleNext,
    progress,
    isSafeToOperate,
    safeTimeout,
  ]);

  if (isLoading) {
    return <StoryViewerLoadingState insets={insets} label="Loading story" />;
  }

  if ((!story || !currentItem) && (isLoading || isFetching)) {
    return <StoryViewerLoadingState insets={insets} label="Finding story" />;
  }

  if (!story || !currentItem) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: "#000",
          justifyContent: "center",
          alignItems: "center",
        }}
      >
        <Text style={{ color: "#fff" }}>Story not found</Text>
        <Pressable
          onPress={() => router.back()}
          style={{
            marginTop: 20,
            paddingHorizontal: 20,
            paddingVertical: 10,
            backgroundColor: "rgba(255,255,255,0.15)",
            borderRadius: 20,
          }}
        >
          <Text style={{ color: "#fff", fontWeight: "600" }}>Go Back</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <KeyboardProvider statusBarTranslucent navigationBarTranslucent>
      <KeyboardAvoidingView
        behavior="padding"
        style={{ flex: 1, backgroundColor: "#000" }}
      >
        <View style={{ flex: 1, backgroundColor: "#000" }}>
          {/* ── FULL-BLEED MEDIA ───────────────────────────────────────────── */}
          <View
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
            }}
          >
            {isVideo && videoUrl && player ? (
              <>
                <VideoView
                  player={player}
                  style={{ width: "100%", height: "100%" }}
                  contentFit="cover"
                  nativeControls={false}
                  fullscreenOptions={{ enable: false }}
                  allowsPictureInPicture={false}
                  onFirstFrameRender={() => setShowVideoPoster(false)}
                />
                {showVideoPoster && currentItem?.thumbnail ? (
                  <Image
                    source={{ uri: currentItem.thumbnail }}
                    style={{
                      position: "absolute",
                      width: "100%",
                      height: "100%",
                    }}
                    contentFit="cover"
                  />
                ) : null}
                <VideoSeekBar
                  currentTime={videoCurrentTime}
                  duration={videoDuration}
                  onSeek={handleSeek}
                  visible={showSeekBar}
                  barWidth={width - 32}
                />
              </>
            ) : currentItem?.type === "gif" &&
              currentItem?.url &&
              (currentItem.url.startsWith("http://") ||
                currentItem.url.startsWith("https://")) ? (
              <DVNTGifView
                uri={currentItem.url}
                width="100%"
                height="100%"
                contentFit="cover"
              />
            ) : isImage &&
              currentItem?.url &&
              (currentItem.url.startsWith("http://") ||
                currentItem.url.startsWith("https://")) ? (
              <Image
                source={{ uri: currentItem.url }}
                style={{ width: "100%", height: "100%" }}
                contentFit="cover"
                transition={150}
                cachePolicy="memory-disk"
              />
            ) : currentItem?.type === "text" ? (
              <TextOnlyStoryViewer item={currentItem} insets={insets} />
            ) : (
              <View
                style={{
                  flex: 1,
                  justifyContent: "center",
                  alignItems: "center",
                }}
              >
                <Text style={{ color: "rgba(255,255,255,0.5)", fontSize: 14 }}>
                  No content
                </Text>
              </View>
            )}

            <StoryOverlayLayer overlays={storyOverlays} />
          </View>

          {/* ── TOP OVERLAY: progress bars + header ───────────────────────── */}
          <View
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              zIndex: 50,
            }}
            pointerEvents="box-none"
          >
            {/* Progress bars */}
            <View
              style={{
                flexDirection: "row",
                paddingHorizontal: 10,
                paddingTop: storyChromeTopInset,
                gap: 3,
              }}
            >
              {story.items?.map((_: any, index: number) => (
                <View
                  key={index}
                  style={{
                    flex: 1,
                    height: 2.5,
                    backgroundColor: "rgba(255,255,255,0.35)",
                    borderRadius: 2,
                    overflow: "hidden",
                  }}
                >
                  {index < currentItemIndex ? (
                    <View
                      style={{
                        flex: 1,
                        backgroundColor: "rgba(255,255,255,0.92)",
                      }}
                    />
                  ) : index === currentItemIndex ? (
                    <ProgressBar progress={progress} />
                  ) : null}
                </View>
              ))}
            </View>

            {/* Header row: avatar + name | X */}
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                paddingHorizontal: 14,
                paddingTop: 10,
                paddingBottom: 6,
              }}
              pointerEvents="box-none"
            >
              <Pressable
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 10,
                  flex: 1,
                }}
                onPress={() => {
                  if (!story?.username) return;
                  isPaused.current = true;
                  cancelAnimation(progress);
                  try {
                    player?.pause();
                  } catch {}
                  if (
                    story.username.toLowerCase() ===
                    currentUser?.username?.toLowerCase()
                  ) {
                    router.push("/(protected)/(tabs)/profile");
                  } else {
                    screenPrefetch.profile(queryClient, story.username);
                    router.push(`/(protected)/profile/${story.username}`);
                  }
                }}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Image
                  source={{ uri: story.avatar }}
                  style={{
                    width: 46,
                    height: 46,
                    borderRadius: 12,
                    borderWidth: 1.5,
                    borderColor: "rgba(255,255,255,0.4)",
                  }}
                />
                <View style={{ flex: 1 }}>
                  <Text
                    style={{
                      color: "#fff",
                      fontWeight: "700",
                      fontSize: 14,
                      textShadowColor: "rgba(0,0,0,0.9)",
                      textShadowOffset: { width: 0, height: 1 },
                      textShadowRadius: 6,
                    }}
                    numberOfLines={1}
                  >
                    {story.username}
                  </Text>
                  {(currentItem as any).header?.subheading ? (
                    <Text
                      style={{
                        color: "rgba(255,255,255,0.75)",
                        fontSize: 12,
                        textShadowColor: "rgba(0,0,0,0.4)",
                        textShadowOffset: { width: 0, height: 1 },
                        textShadowRadius: 3,
                      }}
                      numberOfLines={1}
                    >
                      {(currentItem as any).header?.subheading}
                    </Text>
                  ) : null}
                </View>
              </Pressable>
              <Pressable
                onPress={() => {
                  if (isExitingRef.current) return;
                  markExiting();
                  cancelAnimation(progress);
                  if (router.canDismiss()) {
                    router.dismiss();
                  } else {
                    router.back();
                  }
                }}
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: 8,
                  backgroundColor: "rgba(0,0,0,0.55)",
                  alignItems: "center",
                  justifyContent: "center",
                }}
                hitSlop={{ top: 16, bottom: 16, left: 16, right: 16 }}
              >
                <X size={18} color="rgb(255, 109, 193)" strokeWidth={2.5} />
              </Pressable>
            </View>

            {hasAnimatedContent ? (
              <View
                pointerEvents="none"
                style={{
                  alignSelf: "flex-start",
                  marginLeft: 14,
                  marginTop: 2,
                  paddingHorizontal: 10,
                  paddingVertical: 5,
                  borderRadius: 999,
                  backgroundColor: "rgba(255,91,252,0.88)",
                }}
              >
                <Text
                  style={{
                    color: "#fff",
                    fontSize: 11,
                    fontWeight: "800",
                    letterSpacing: 0.35,
                    textTransform: "uppercase",
                  }}
                >
                  Animated
                </Text>
              </View>
            ) : null}
          </View>

          {/* ── TOUCH ZONES (prev / next) ─────────────────────────────────── */}
          <View
            style={{
              position: "absolute",
              top: touchZonesTop,
              bottom: isOwnStory ? 0 : 110,
              left: 0,
              right: 0,
              flexDirection: "row",
              zIndex: 20,
            }}
            pointerEvents="box-none"
          >
            <Pressable
              onPressIn={handleLongPressStart}
              onPressOut={handlePrevPressOut}
              style={{ flex: 1 }}
            />
            <Pressable
              onPressIn={handleLongPressStart}
              onPressOut={handleNextPressOut}
              style={{ flex: 1 }}
            />
          </View>

          {/* ── TAGGED USERS PILL ─────────────────────────────────────────── */}
          {storyTags.length > 0 && (
            <Pressable
              onPress={() => setShowTags(!showTags)}
              style={{
                position: "absolute",
                bottom: isOwnStory ? insets.bottom + 20 : 130,
                alignSelf: "center",
                flexDirection: "row",
                alignItems: "center",
                gap: 6,
                backgroundColor: "rgba(0,0,0,0.6)",
                paddingHorizontal: 14,
                paddingVertical: 8,
                borderRadius: 20,
                borderWidth: 1,
                borderColor: "rgba(255,255,255,0.18)",
                zIndex: 60,
              }}
            >
              {showTags ? (
                <View style={{ gap: 6 }}>
                  {storyTags.map((tag) => (
                    <Pressable
                      key={tag.id}
                      onPress={() => {
                        isPaused.current = true;
                        cancelAnimation(progress);
                        try {
                          player?.pause();
                        } catch {}
                        if (
                          tag.username.toLowerCase() ===
                          currentUser?.username?.toLowerCase()
                        ) {
                          router.push("/(protected)/(tabs)/profile");
                        } else {
                          screenPrefetch.profile(queryClient, tag.username);
                          router.push(`/(protected)/profile/${tag.username}`);
                        }
                      }}
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 8,
                      }}
                    >
                      <Image
                        source={{ uri: (tag as any).avatar || "" }}
                        style={{ width: 22, height: 22, borderRadius: 6 }}
                      />
                      <Text
                        style={{
                          color: "#fff",
                          fontSize: 13,
                          fontWeight: "600",
                        }}
                      >
                        @{tag.username}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              ) : (
                <>
                  <Image
                    source={{ uri: (storyTags[0] as any).avatar || "" }}
                    style={{ width: 20, height: 20, borderRadius: 5 }}
                  />
                  <Text
                    style={{ color: "#fff", fontSize: 12, fontWeight: "600" }}
                  >
                    {storyTags.length === 1
                      ? `@${storyTags[0].username}`
                      : `@${storyTags[0].username} +${storyTags.length - 1}`}
                  </Text>
                </>
              )}
            </Pressable>
          )}

          {/* ── OWN STORY: viewer count + delete ──────────────────────────── */}
          {isOwnStory && persistedStoryItemId && (
            <>
              <Pressable
                // Prefetch viewers the moment the user's finger presses down
                // on the pill — by the time the sheet opens (onPress) the data
                // is already in React Query's cache, so the sheet shows the
                // list instantly instead of flashing a spinner.
                onPressIn={() => {
                  if (!currentStoryId) return;
                  queryClient.prefetchQuery({
                    queryKey: storyViewKeys.viewers(String(currentStoryId)),
                    queryFn: () =>
                      storyViewsApi.getViewers(String(currentStoryId)),
                    staleTime: 4500,
                  });
                }}
                onPress={() => {
                  isPaused.current = true;
                  cancelAnimation(progress);
                  try {
                    player?.pause();
                  } catch {}
                  setShowViewersSheet(true);
                }}
                style={{
                  position: "absolute",
                  bottom: insets.bottom + 20,
                  left: 16,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 6,
                  backgroundColor: "rgba(0,0,0,0.55)",
                  paddingHorizontal: 14,
                  paddingVertical: 9,
                  borderRadius: 22,
                  borderWidth: 1,
                  borderColor: "rgba(255,255,255,0.18)",
                  zIndex: 60,
                }}
              >
                <Eye size={16} color="#fff" />
                <View
                  style={{
                    minWidth: 18,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  {viewerCountLoading ||
                  (viewerCountFetching && viewerCount == null) ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Text
                      style={{ color: "#fff", fontSize: 13, fontWeight: "700" }}
                    >
                      {viewerCount ?? 0}
                    </Text>
                  )}
                </View>
              </Pressable>

              <Pressable
                onPress={handleDeleteStory}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                style={{
                  position: "absolute",
                  bottom: insets.bottom + 20,
                  right: 16,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 6,
                  backgroundColor: "rgba(0,0,0,0.55)",
                  paddingHorizontal: 14,
                  paddingVertical: 9,
                  borderRadius: 22,
                  borderWidth: 1,
                  borderColor: "rgba(255,90,90,0.3)",
                  zIndex: 60,
                }}
              >
                <Trash2 size={16} color="#FF5555" />
                <Text
                  style={{ color: "#FF5555", fontSize: 13, fontWeight: "700" }}
                >
                  Delete
                </Text>
              </Pressable>
            </>
          )}

          {/* ── STORY VIEWERS SHEET ───────────────────────────────────────── */}
          <StoryViewersSheet
            storyId={viewableStoryId}
            visible={showViewersSheet}
            onClose={() => {
              setShowViewersSheet(false);
              isPaused.current = false;
            }}
          />

          {/* ── FLOATING EMOJI REACTIONS ──────────────────────────────────── */}
          {floatingEmojis.map((e) => (
            <FloatingReactionEmoji
              key={e.id}
              emoji={e.emoji}
              onComplete={() => removeFloatingEmoji(e.id)}
            />
          ))}
          {/* ── BOTTOM BAR: overlay inside story stage so media stays edge-to-edge ── */}
          {!isOwnStory && story && (
            <View
              pointerEvents="box-none"
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                bottom: 0,
                zIndex: 70,
              }}
            >
              {/* Emoji reactions row — hidden while typing */}
              {!isInputFocused && (
                <View
                  pointerEvents="auto"
                  style={{
                    flexDirection: "row",
                    justifyContent: "center",
                    gap: 8,
                    paddingHorizontal: 20,
                    marginBottom: 10,
                    zIndex: 80,
                  }}
                >
                  {REACTION_EMOJIS.map((emoji) => (
                    <Pressable
                      key={emoji}
                      onPress={() => handleQuickReaction(emoji)}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      style={{
                        width: 46,
                        height: 46,
                        borderRadius: 23,
                        backgroundColor: "rgba(40,40,40,0.8)",
                        borderWidth: 1,
                        borderColor: "rgba(255,255,255,0.15)",
                        alignItems: "center",
                        justifyContent: "center",
                        zIndex: 81,
                      }}
                    >
                      <Text style={{ fontSize: 22 }}>{emoji}</Text>
                    </Pressable>
                  ))}
                </View>
              )}

              {/* Message input row — liquid glass pill */}
              <View
                style={{
                  paddingHorizontal: 12,
                  paddingTop: 6,
                  paddingBottom: Math.max(insets.bottom, 8),
                }}
              >
                <DVNTLiquidGlass paddingH={6} paddingV={6} radius={28}>
                  <TextInput
                    style={{
                      flex: 1,
                      color: "#fff",
                      fontSize: 15,
                      paddingVertical: 6,
                      paddingHorizontal: 12,
                    }}
                    placeholder="Send Message"
                    placeholderTextColor="rgba(255,255,255,0.45)"
                    value={replyText}
                    onChangeText={setReplyText}
                    onFocus={() => setIsInputFocused(true)}
                    onBlur={() => setIsInputFocused(false)}
                    returnKeyType="send"
                    onSubmitEditing={handleSendReply}
                    editable={!isSendingReply}
                  />
                  <Pressable
                    onPress={
                      replyText.trim().length > 0 ? handleSendReply : undefined
                    }
                    disabled={isSendingReply || !resolvedUserId}
                    hitSlop={{ top: 10, bottom: 10, left: 4, right: 4 }}
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 18,
                      backgroundColor:
                        replyText.trim().length > 0
                          ? "#8A40CF"
                          : "rgba(255,255,255,0.15)",
                      alignItems: "center",
                      justifyContent: "center",
                      opacity: isSendingReply ? 0.5 : 1,
                    }}
                  >
                    <Send size={17} color="#fff" strokeWidth={2} />
                  </Pressable>
                </DVNTLiquidGlass>
              </View>
            </View>
          )}
        </View>
      </KeyboardAvoidingView>
    </KeyboardProvider>
  );
}

// Wrap with ErrorBoundary for crash protection
export default function StoryViewerScreen() {
  const router = useRouter();

  return (
    <ErrorBoundary
      screenName="StoryViewer"
      onGoHome={() => router.replace("/(protected)/(tabs)/feed" as any)}
    >
      <StoryViewerScreenContent />
    </ErrorBoundary>
  );
}
