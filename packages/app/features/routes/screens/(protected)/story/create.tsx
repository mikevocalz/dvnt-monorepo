import {
  View,
  Text,
  Pressable,
  ScrollView,
  Alert,
  useWindowDimensions,
} from "react-native";
import { Image } from "expo-image";
import { VideoView, useVideoPlayer } from "expo-video";
import {
  X,
  Image as ImageIcon,
  Video,
  Camera,
  ChevronLeft,
  ChevronRight,
  Pencil,
  Type,
  Sticker,
  Sparkles,
  Download,
  Star,
  Globe,
  UserPlus,
} from "lucide-react-native";
import {
  useRouter,
  useNavigation,
  useFocusEffect,
  useLocalSearchParams,
} from "expo-router";
import { ErrorBoundary } from "@dvnt/app/components/error-boundary";
import { Motion } from "@legendapp/motion";
import { useColorScheme } from "@dvnt/app/lib/hooks";
import { useCreateStoryStore } from "@dvnt/app/lib/stores/create-story-store";
import type { MediaAsset } from "@dvnt/app/lib/hooks/use-media-picker";
import { useMediaPicker } from "@dvnt/app/lib/hooks";
import {
  useCallback,
  useLayoutEffect,
  useEffect,
  useState,
  useRef,
} from "react";
import { useCreateStory } from "@dvnt/app/lib/hooks/use-stories";
import { useMediaUpload } from "@dvnt/app/lib/hooks/use-media-upload";
import { useUIStore } from "@dvnt/app/lib/stores/ui-store";
import * as Haptics from "expo-haptics";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useSafeHeader } from "@dvnt/app/lib/hooks/use-safe-header";
import { StoryTagPicker } from "@dvnt/app/components/stories/story-tag-picker";
import { storyTagsApi } from "@dvnt/app/lib/api/stories";
// generateVideoThumbnail disabled — expo-video-thumbnails hangs on iOS 26.3
import { useCameraResultStore } from "@dvnt/app/lib/stores/camera-result-store";
import { useStoryFlowStore } from "@dvnt/app/lib/stores/story-flow-store";
import { useStoryEditorResultStore } from "@dvnt/app/lib/stores/story-editor-result-store";
import type { StoryAnimatedGifOverlay, StoryOverlay } from "@dvnt/app/lib/types";
import * as LegacyFileSystem from "expo-file-system/legacy";
import { DVNTGifView } from "@dvnt/app/components/media/DVNTGifView";
import { getImageStickerSourceById } from "@dvnt/app/src/stories-editor/constants";

function StoryVideoPreview({ uri }: { uri: string }) {
  const [isPlaying, setIsPlaying] = useState(false);
  const player = useVideoPlayer(uri, (p) => {
    p.loop = true;
    p.muted = false;
    // Story *creation* preview — the user is actively reviewing what
    // they're about to post. Duck other audio rather than stopping it.
    p.audioMixingMode = "duckOthers";
  });

  const togglePlay = useCallback(() => {
    if (isPlaying) {
      player.pause();
      setIsPlaying(false);
    } else {
      player.play();
      setIsPlaying(true);
    }
  }, [isPlaying, player]);

  return (
    <Pressable onPress={togglePlay} style={{ flex: 1 }}>
      <VideoView
        player={player}
        style={{ width: "100%", height: "100%" }}
        contentFit="cover"
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
              backgroundColor: "rgba(0,0,0,0.6)",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Video size={24} color="#fff" />
          </View>
        </View>
      )}
    </Pressable>
  );
}

function StoryOverlayPreview({
  overlays,
  width,
  height,
}: {
  overlays: StoryOverlay[];
  width: number;
  height: number;
}) {
  if (overlays.length === 0) return null;

  return (
    <View pointerEvents="none" style={{ position: "absolute", inset: 0 }}>
      {overlays.map((overlay) => {
        if (overlay.type === "animated_gif") {
          const size = width * overlay.sizeRatio * overlay.scale;
          return (
            <View
              key={overlay.id}
              style={{
                position: "absolute",
                left: width * overlay.x - size / 2,
                top: height * overlay.y - size / 2,
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
          return (
            <Text
              key={overlay.id}
              style={{
                position: "absolute",
                left: width * overlay.x - size / 2,
                top: height * overlay.y - size / 2,
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
          const fontSize = Math.max(width * overlay.fontSizeRatio * overlay.scale, 16);
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
                  lineHeight: fontSize * 1.12,
                  fontWeight: "700",
                  textAlign: overlay.textAlign || "center",
                  fontFamily: overlay.fontFamily || undefined,
                }}
              >
                {overlay.content}
              </Text>
            </View>
          );
        }

        const size = width * overlay.sizeRatio * overlay.scale;
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
              left: width * overlay.x - size / 2,
              top: height * overlay.y - size / 2,
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

// Creative tools — floating vertical toolbar on canvas
const CREATIVE_TOOLS = [
  { id: "text", icon: Type, label: "Aa" },
  { id: "stickers", icon: Sticker, label: "Stickers" },
  { id: "draw", icon: Pencil, label: "Draw" },
  { id: "effects", icon: Sparkles, label: "Effects" },
  { id: "save", icon: Download, label: "Save" },
] as const;

const MAX_STORY_ITEMS = 4;
const MAX_VIDEO_DURATION = 30;
const MAX_FILE_SIZE_MB = 50;

function normalizeSharedUri(rawUri: string): string | null {
  const decodedUri = decodeURIComponent(rawUri).trim();
  if (!decodedUri) return null;

  if (/^(file|content|assets-library|ph|https?):\/\//i.test(decodedUri)) {
    return decodedUri;
  }

  if (decodedUri.startsWith("/")) {
    return `file://${decodedUri}`;
  }

  return decodedUri;
}

function inferSharedAssetExtension(
  uri: string,
  type: "image" | "video",
): string {
  const path = uri.split("?")[0] || uri;
  const pathMatch = path.match(/\.([a-zA-Z0-9]+)$/);

  if (pathMatch?.[1]) {
    return pathMatch[1].toLowerCase();
  }

  return type === "video" ? "mp4" : "jpg";
}

function CreateStoryScreenContent() {
  const router = useRouter();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const { colors } = useColorScheme();
  const transitionTo = useStoryFlowStore((s) => s.transitionTo);
  const forceIdle = useStoryFlowStore((s) => s.forceIdle);
  const ensureHubState = useCallback(() => {
    const flow = useStoryFlowStore.getState();
    if (flow.state === "IDLE") {
      flow.transitionTo("HUB");
    }
  }, []);

  // ── Responsive layout ─────────────────────────────────────────────
  const CANVAS_WIDTH = width - 32;
  const CANVAS_HEIGHT = Math.min(height * 0.55, CANVAS_WIDTH * (16 / 9));

  const {
    reset,
    currentIndex,
    setCurrentIndex,
    mediaAssets,
    setMediaAssets,
    nextSlide,
    prevSlide,
    isSharing,
    setIsSharing,
    visibility,
    setVisibility,
    taggedUsers,
    setTaggedUsers,
    showTagPicker,
    setShowTagPicker,
    videoThumbnails,
    setVideoThumbnail,
  } = useCreateStoryStore();

  const { pickFromLibrary, requestPermissions } = useMediaPicker();
  const { mutate: createStoryMutate, isPending: isCreateStoryPending } =
    useCreateStory();
  const showToast = useUIStore((s) => s.showToast);
  const {
    uploadMultiple,
    progress: uploadProgress,
    statusMessage: uploadStatus,
    cancelUpload,
  } = useMediaUpload({ folder: "stories" });

  const consumeCameraResult = useCameraResultStore((s) => s.consumeResult);
  const consumeEditorResult = useStoryEditorResultStore((s) => s.consumeResult);
  const sharedImportKeyRef = useRef<string | null>(null);

  // Pick up edited URI coming back from the Skia editor
  const {
    editedUri,
    editedIndex,
    sharedUri,
    sharedType,
    openEditor,
    sharedAt,
  } = useLocalSearchParams<{
    editedUri?: string;
    editedIndex?: string;
    sharedUri?: string;
    sharedType?: string;
    openEditor?: string;
    sharedAt?: string;
  }>();

  const applyEditedResult = useCallback(
    (
      uri: string,
      rawIndex?: string | number,
      mediaType: "image" | "video" = "image",
      storyOverlays: StoryOverlay[] = [],
      animatedGifOverlays: StoryAnimatedGifOverlay[] = [],
    ) => {
      const idx =
        typeof rawIndex === "number"
          ? rawIndex
          : Number.parseInt(rawIndex ?? "", 10);

      if (!Number.isNaN(idx) && mediaAssets[idx]) {
        const updated = [...mediaAssets];
        updated[idx] = {
          ...updated[idx],
          uri,
          type: mediaType,
          kind: mediaType === "video" ? "video" : "image",
          storyOverlays,
          storyAnimatedGifOverlays: animatedGifOverlays,
        };
        setMediaAssets(updated);
        setCurrentIndex(idx);
        console.log("[Story] Applied edited image at index", idx);
        return;
      }

      if (mediaAssets.length === 0) {
        const asset: MediaAsset = {
          id: uri,
          uri,
          type: mediaType,
          kind: mediaType === "video" ? "video" : "image",
          storyOverlays,
          storyAnimatedGifOverlays: animatedGifOverlays,
        };
        setMediaAssets([asset]);
        setCurrentIndex(0);
        console.log("[Story] Applied text-only story snapshot");
      }
    },
    [mediaAssets, setCurrentIndex, setMediaAssets],
  );

  useEffect(() => {
    if (editedUri && editedIndex !== undefined) {
      applyEditedResult(editedUri, editedIndex);
    }
  }, [applyEditedResult, editedUri, editedIndex]);

  useEffect(() => {
    requestPermissions();
  }, [requestPermissions]);

  useFocusEffect(
    useCallback(() => {
      ensureHubState();

      const editorResult = consumeEditorResult();
      if (editorResult) {
        applyEditedResult(
          editorResult.uri,
          editorResult.index,
          editorResult.mediaType,
          editorResult.storyOverlays,
          editorResult.animatedGifOverlays,
        );
      }
    }, [applyEditedResult, consumeEditorResult, ensureHubState]),
  );

  const handleMediaSelected = useCallback(
    (media: MediaAsset[]) => {
      const currentCount = mediaAssets.length;
      const newItems = media.slice(0, MAX_STORY_ITEMS - currentCount);

      if (media.length > MAX_STORY_ITEMS - currentCount) {
        showToast(
          "warning",
          "Story Limit",
          `You can add up to ${MAX_STORY_ITEMS} items per story.`,
        );
      }

      const validMedia: MediaAsset[] = [];
      const errors: string[] = [];

      for (const item of newItems) {
        if (item.type === "video") {
          if (item.duration && item.duration > MAX_VIDEO_DURATION) {
            errors.push(`Video must be ${MAX_VIDEO_DURATION}s or less`);
            continue;
          }
          const fileSizeMB = item.fileSize ? item.fileSize / (1024 * 1024) : 0;
          if (fileSizeMB > MAX_FILE_SIZE_MB) {
            errors.push(`Video exceeds ${MAX_FILE_SIZE_MB}MB limit`);
            continue;
          }
        }
        validMedia.push(item);
      }

      if (errors.length > 0) {
        showToast(
          "warning",
          "Some videos couldn't be added",
          errors.join(", "),
        );
      }

      if (validMedia.length > 0) {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        const updatedAssets = [...mediaAssets, ...validMedia];
        setMediaAssets(updatedAssets);
        setCurrentIndex(mediaAssets.length === 0 ? 0 : mediaAssets.length);

        // NOTE: Video thumbnail generation disabled — expo-video-thumbnails
        // hangs on iOS 26.3. The Video icon fallback handles the preview.
      }
    },
    [
      mediaAssets,
      setMediaAssets,
      setCurrentIndex,
      setVideoThumbnail,
      showToast,
    ],
  );

  const handlePickLibrary = async () => {
    if (mediaAssets.length >= MAX_STORY_ITEMS) {
      showToast(
        "warning",
        "Story Limit",
        `Maximum ${MAX_STORY_ITEMS} items per story.`,
      );
      return;
    }
    try {
      const media = await pickFromLibrary?.({
        maxSelection: MAX_STORY_ITEMS - mediaAssets.length,
        allowsMultipleSelection: true,
      });
      if (media && media.length > 0) {
        handleMediaSelected(media);
      }
    } catch (error) {
      showToast("error", "Error", "Failed to pick media.");
    }
  };

  // Consume camera result when returning from camera screen
  // Auto-open the Skia editor for images so user skips the extra tap
  useFocusEffect(
    useCallback(() => {
      const result = consumeCameraResult();
      if (result) {
        const media: MediaAsset = {
          id: result.uri,
          uri: result.uri,
          type: result.type,
          kind: result.type === "video" ? "video" : "image",
          width: result.width,
          height: result.height,
          duration: result.duration,
        };
        handleMediaSelected([media]);

        // Auto-open editor for images (skip the redundant canvas-tap step)
        if (result.type === "image") {
          setTimeout(() => {
            router.push({
              pathname: "/(protected)/story/editor",
              params: {
                uri: encodeURIComponent(result.uri),
                type: result.type,
              },
            });
          }, 300);
        }
      }
    }, [consumeCameraResult, handleMediaSelected, router]),
  );

  const handleCreateTextStory = () => {
    ensureHubState();
    transitionTo("TEXT_ONLY");
    router.push({
      pathname: "/(protected)/story/editor",
      params: {
        uri: "",
        type: "image",
        initialMode: "text",
      },
    });
  };

  const handleOpenCamera = () => {
    if (mediaAssets.length >= MAX_STORY_ITEMS) {
      showToast(
        "warning",
        "Story Limit",
        `Maximum ${MAX_STORY_ITEMS} items per story.`,
      );
      return;
    }
    router.push({
      pathname: "/(protected)/camera",
      params: {
        mode: "both",
        source: "story",
        maxDuration: String(MAX_VIDEO_DURATION),
      },
    });
  };

  const handleRemoveMedia = (index: number) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const updated = mediaAssets.filter((_, i) => i !== index);
    setMediaAssets(updated);
    if (currentIndex >= updated.length && updated.length > 0) {
      setCurrentIndex(updated.length - 1);
    } else if (updated.length === 0) {
      setCurrentIndex(0);
    }
  };

  const handleOpenSkiaEditor = useCallback(
    (index: number, initialMode?: string) => {
      const asset = mediaAssets[index];
      if (!asset) return;

      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      ensureHubState();
      transitionTo(asset.type === "video" ? "EDIT_VIDEO" : "EDIT_IMAGE");
      router.push({
        pathname: "/(protected)/story/editor",
        params: {
          uri: encodeURIComponent(asset.uri),
          type: asset.type,
          index: String(index),
          ...(initialMode && { initialMode }),
        },
      });
    },
    [ensureHubState, mediaAssets, router, transitionTo],
  );

  useEffect(() => {
    if (!sharedUri) return;

    const importKey = [
      sharedAt || "shared",
      sharedType || "image",
      sharedUri,
      openEditor || "0",
    ].join(":");

    if (sharedImportKeyRef.current === importKey) {
      return;
    }

    sharedImportKeyRef.current = importKey;
    let cancelled = false;

    void (async () => {
      try {
        const normalizedType = sharedType === "video" ? "video" : "image";
        const normalizedUri = normalizeSharedUri(sharedUri);

        if (!normalizedUri) {
          throw new Error("Missing shared asset URI");
        }

        let accessibleUri = normalizedUri;
        if (/^https?:\/\//i.test(normalizedUri)) {
          const extension = inferSharedAssetExtension(
            normalizedUri,
            normalizedType,
          );
          const downloadPath = `${LegacyFileSystem.cacheDirectory}story-share-${Date.now()}.${extension}`;
          const download = await LegacyFileSystem.downloadAsync(
            normalizedUri,
            downloadPath,
          );
          accessibleUri = download.uri;
        }

        if (cancelled) return;

        const asset: MediaAsset = {
          id: `${accessibleUri}-${sharedAt || Date.now()}`,
          uri: accessibleUri,
          type: normalizedType,
          kind: normalizedType === "video" ? "video" : "image",
        };

        reset();
        setMediaAssets([asset]);
        setCurrentIndex(0);
        ensureHubState();

        if (openEditor === "1") {
          setTimeout(() => {
            if (cancelled) return;

            router.push({
              pathname: "/(protected)/story/editor",
              params: {
                uri: encodeURIComponent(asset.uri),
                type: asset.type,
                index: "0",
              },
            });
          }, 300);
        }
      } catch (error) {
        console.warn("[Story] Failed to import shared asset:", error);
        if (!cancelled) {
          showToast(
            "error",
            "Share Failed",
            "We couldn't import that media into your story.",
          );
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    ensureHubState,
    openEditor,
    reset,
    router,
    setCurrentIndex,
    setMediaAssets,
    sharedAt,
    sharedType,
    sharedUri,
    showToast,
  ]);

  const handleShare = useCallback(async () => {
    console.log("[Story] handleShare called", {
      isSharing,
      isPending: isCreateStoryPending,
      mediaAssetsCount: mediaAssets.length,
    });

    if (isSharing || isCreateStoryPending) {
      console.log("[Story] handleShare blocked:", {
        isSharing,
        isPending: isCreateStoryPending,
      });
      return;
    }
    if (mediaAssets.length === 0) {
      showToast("warning", "Empty Story", "Please add media to your story");
      return;
    }

    setIsSharing(true);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

    try {
      const mediaFiles = mediaAssets.map((m) => ({
        uri: m.uri,
        type: m.type as "image" | "video",
        kind: m.kind,
        mimeType: m.mimeType,
        pairedVideoUri: m.pairedVideoUri,
      }));
      console.log("[Story] Uploading", mediaFiles.length, "files");

      const uploadResults = await uploadMultiple(mediaFiles);
      console.log(
        "[Story] Upload results:",
        uploadResults.map((r) => ({ success: r.success, error: r.error })),
      );
      const failedUploads = uploadResults.filter((r) => !r.success);

      if (failedUploads.length > 0) {
        console.error("[Story] Upload failures:", failedUploads);
        setIsSharing(false);
        showToast(
          "error",
          "Upload Error",
          failedUploads[0]?.error || "Failed to upload media.",
        );
        return;
      }

      const storyItems = uploadResults.map((r, index) => ({
        type: r.kind ?? r.type,
        url: r.url,
        ...(r.path && { storageKey: r.path }),
        thumbnail: r.thumbnail,
        ...(r.thumbnailPath && { thumbnailKey: r.thumbnailPath }),
        ...(r.mimeType && { mimeType: r.mimeType }),
        ...(r.livePhotoVideoUrl && { livePhotoVideoUrl: r.livePhotoVideoUrl }),
        storyOverlays: mediaAssets[index]?.storyOverlays || [],
        animatedGifOverlays:
          mediaAssets[index]?.storyAnimatedGifOverlays || [],
      }));
      console.log("[Story] Creating story with", storyItems.length, "items");

      createStoryMutate(
        { items: storyItems, visibility },
        {
          onSuccess: (newStory: any) => {
            console.log("[Story] Story created!", newStory?.id);
            if (taggedUsers.length > 0 && newStory?.id) {
              const tags = taggedUsers.map((u) => ({
                userId: u.id,
                x: 0.5,
                y: 0.5,
              }));
              storyTagsApi.addTags(String(newStory.id), tags).catch((err) => {
                console.error("[Story] Failed to save tags:", err);
              });
            }
            setIsSharing(false);
            showToast("success", "Success", "Story shared successfully!");
            reset();
            router.back();
          },
          onError: (error: any) => {
            console.error("[Story] createStory mutation error:", error);
            setIsSharing(false);
            showToast(
              "error",
              "Error",
              error?.message || "Failed to share story.",
            );
          },
        },
      );
    } catch (error: any) {
      console.error("[Story] handleShare error:", error);
      setIsSharing(false);
      showToast("error", "Error", error?.message || "Something went wrong.");
    }
  }, [
    createStoryMutate,
    isCreateStoryPending,
    isSharing,
    mediaAssets,
    reset,
    router,
    setIsSharing,
    showToast,
    taggedUsers,
    uploadMultiple,
    visibility,
  ]);

  const handleClose = useCallback(() => {
    if (mediaAssets.length > 0) {
      Alert.alert("Discard Story?", "You have unsaved changes.", [
        { text: "Keep Editing", style: "cancel" },
        {
          text: "Discard",
          style: "destructive",
          onPress: () => {
            reset();
            forceIdle();
            router.back();
          },
        },
      ]);
    } else {
      forceIdle();
      router.back();
    }
  }, [forceIdle, mediaAssets.length, reset, router]);

  const currentAsset = mediaAssets[currentIndex];
  const currentMedia = currentAsset?.uri;
  const currentMediaType = currentAsset?.type;
  const isValid = mediaAssets.length > 0;
  const currentStoryOverlays =
    currentAsset?.storyOverlays?.length
      ? currentAsset.storyOverlays
      : (currentAsset?.storyAnimatedGifOverlays || []).map((overlay) => ({
          ...overlay,
          type: "animated_gif" as const,
        }));
  const creativeTools = (
    currentMediaType === "video"
      ? CREATIVE_TOOLS.filter((tool) =>
          ["text", "stickers", "save"].includes(tool.id),
        )
      : CREATIVE_TOOLS
  );

  // FIX: Use safe header update to prevent loops
  useSafeHeader({
    headerShown: true,
    headerTitle: "New Story",
    headerTitleAlign: "left" as const,
    headerStyle: { backgroundColor: colors.background },
    headerTitleStyle: {
      color: colors.foreground,
      fontWeight: "600",
      fontSize: 18,
    },
    headerLeft: () => (
      <Pressable
        onPress={handleClose}
        hitSlop={12}
        className="ml-2 w-11 h-11 items-center justify-center"
      >
        <X size={24} color={colors.foreground} strokeWidth={2.5} />
      </Pressable>
    ),
    headerRight: () => (
      <Pressable
        onPress={handleShare}
        disabled={isSharing || !isValid}
        hitSlop={12}
        className="mr-2"
      >
        <Text
          className={`text-sm font-semibold ${isValid && !isSharing ? "text-primary" : "text-muted-foreground"}`}
        >
          {isSharing ? "Sharing..." : "Share"}
        </Text>
      </Pressable>
    ),
  }, [handleClose, handleShare, isSharing, isValid]);

  return (
    <>
      <ScrollView
        className="flex-1 bg-background"
        contentContainerStyle={{ flexGrow: 1 }}
        contentInsetAdjustmentBehavior="automatic"
      >
        {/* Upload Progress Overlay */}
        {isSharing && (
          <Motion.View
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="absolute top-20 left-4 right-4 bg-black/90 rounded-xl p-4 z-50"
            style={{ borderCurve: "continuous" }}
          >
            <View className="h-1.5 bg-muted rounded-full overflow-hidden">
              <Motion.View
                className="h-full bg-primary rounded-full"
                initial={{ width: "0%" }}
                animate={{ width: `${uploadProgress}%` }}
              />
            </View>
            <Text className="text-white text-sm font-medium text-center mt-3">
              {uploadStatus ||
                (uploadProgress < 100
                  ? `Uploading... ${uploadProgress}%`
                  : "Processing...")}
            </Text>
            <Pressable
              onPress={() => {
                cancelUpload();
                setIsSharing(false);
              }}
              hitSlop={12}
              style={{
                marginTop: 12,
                alignSelf: "center",
                paddingHorizontal: 20,
                paddingVertical: 8,
                borderRadius: 16,
                backgroundColor: "rgba(255,255,255,0.08)",
              }}
            >
              <Text style={{ color: "#999", fontSize: 13, fontWeight: "600" }}>
                Cancel
              </Text>
            </Pressable>
          </Motion.View>
        )}

        {/* Canvas Area */}
        <View className="flex-1 items-center justify-center px-4 py-6">
          <View
            style={{
              width: CANVAS_WIDTH,
              height: CANVAS_HEIGHT,
              borderCurve: "continuous",
            }}
            className="rounded-2xl overflow-hidden bg-card"
          >
            {currentMedia ? (
              <View className="flex-1 bg-black">
                {currentMediaType === "video" ? (
                  <View className="flex-1 bg-black">
                    <StoryVideoPreview uri={currentMedia} />
                    <StoryOverlayPreview
                      overlays={currentStoryOverlays}
                      width={CANVAS_WIDTH}
                      height={CANVAS_HEIGHT}
                    />
                  </View>
                ) : (
                  <View className="flex-1">
                    <Image
                      source={{ uri: currentMedia }}
                      style={{ width: "100%", height: "100%" }}
                      contentFit="cover"
                    />
                    {/* Tap anywhere to open Skia editor */}
                    <Pressable
                      onPress={() => handleOpenSkiaEditor(currentIndex)}
                      style={{
                        position: "absolute",
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0,
                        zIndex: 0,
                      }}
                    />
                    <StoryOverlayPreview
                      overlays={currentStoryOverlays}
                      width={CANVAS_WIDTH}
                      height={CANVAS_HEIGHT}
                    />
                    {/* Creative tools — vertical toolbar on right */}
                  </View>
                )}

                <View
                  className="absolute right-3 top-10 gap-3"
                  style={{ zIndex: 10, elevation: 10 }}
                  pointerEvents="box-none"
                >
                  {creativeTools.map((tool) => (
                    <Pressable
                      key={tool.id}
                      onPress={() => {
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        if (tool.id === "save") {
                          (async () => {
                            try {
                              const MediaLibrary = require("expo-media-library");
                              const { status } =
                                await MediaLibrary.requestPermissionsAsync();
                              if (status !== "granted") {
                                showToast(
                                  "warning",
                                  "Permission",
                                  "Media library permission required.",
                                );
                                return;
                              }
                              const asset = mediaAssets[currentIndex];
                              if (asset) {
                                await MediaLibrary.saveToLibraryAsync(asset.uri);
                                showToast(
                                  "success",
                                  "Saved",
                                  `${asset.type === "video" ? "Video" : "Image"} saved to gallery`,
                                );
                              }
                            } catch {
                              showToast(
                                "error",
                                "Error",
                                `Failed to save ${currentMediaType === "video" ? "video" : "image"}.`,
                              );
                            }
                          })();
                        } else {
                          const modeMap: Record<string, string> = {
                            text: "text",
                            stickers: "sticker",
                            draw: "drawing",
                            effects: "filter",
                          };
                          handleOpenSkiaEditor(currentIndex, modeMap[tool.id]);
                        }
                      }}
                      className="items-center"
                    >
                      <View
                        className="w-10 h-10 rounded-xl bg-black/60 items-center justify-center"
                        style={{ borderCurve: "continuous" }}
                      >
                        <tool.icon size={20} color="#fff" strokeWidth={2} />
                      </View>
                      <Text
                        className="text-white text-[10px] font-medium mt-0.5"
                        style={{
                          textShadowColor: "rgba(0,0,0,0.8)",
                          textShadowOffset: { width: 0, height: 1 },
                          textShadowRadius: 2,
                        }}
                      >
                        {tool.label}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            ) : (
              <View className="flex-1 bg-card items-center justify-center">
                <ImageIcon size={48} color="#666" />
                <Text className="text-muted-foreground mt-3 text-base">
                  Add media to get started
                </Text>
              </View>
            )}

            {/* Progress indicators */}
            {mediaAssets.length > 1 && (
              <>
                <View className="absolute top-3 left-3 right-3 flex-row gap-1">
                  {mediaAssets.map((_, idx) => (
                    <View
                      key={idx}
                      className={`flex-1 h-0.5 rounded-full ${idx === currentIndex ? "bg-white" : "bg-white/30"}`}
                    />
                  ))}
                </View>

                {currentIndex > 0 && (
                  <Pressable
                    onPress={() => {
                      prevSlide();
                      Haptics.selectionAsync();
                    }}
                    className="absolute left-2 top-1/2 -mt-5 w-10 h-10 rounded-xl bg-black/50 items-center justify-center"
                  >
                    <ChevronLeft size={24} color="#fff" />
                  </Pressable>
                )}

                {currentIndex < mediaAssets.length - 1 && (
                  <Pressable
                    onPress={() => {
                      nextSlide();
                      Haptics.selectionAsync();
                    }}
                    className="absolute right-2 top-1/2 -mt-5 w-10 h-10 rounded-xl bg-black/50 items-center justify-center"
                  >
                    <ChevronRight size={24} color="#fff" />
                  </Pressable>
                )}
              </>
            )}
          </View>

          {/* Media thumbnails */}
          {mediaAssets.length > 0 && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              className="mt-4 max-h-16"
              contentContainerStyle={{ gap: 8, paddingHorizontal: 4 }}
            >
              {mediaAssets.map((asset, idx) => (
                <Pressable
                  key={asset.id}
                  onPress={() => {
                    setCurrentIndex(idx);
                    Haptics.selectionAsync();
                  }}
                  className={`w-14 h-14 rounded-lg overflow-hidden ${idx === currentIndex ? "border-2 border-primary" : ""}`}
                  style={{ borderCurve: "continuous" }}
                >
                  <Image
                    source={{
                      uri: asset.uri,
                    }}
                    style={{ width: "100%", height: "100%" }}
                    contentFit="cover"
                  />
                  <Pressable
                    onPress={() => handleRemoveMedia(idx)}
                    className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-destructive items-center justify-center"
                    hitSlop={8}
                  >
                    <X size={10} color="#fff" />
                  </Pressable>
                  {asset.type === "video" && (
                    <View className="absolute bottom-0.5 left-0.5">
                      <Video size={12} color="#fff" />
                    </View>
                  )}
                </Pressable>
              ))}
            </ScrollView>
          )}
        </View>

        {/* Action buttons */}
        <View className="px-4 pb-6">
          {/* Visibility toggle */}
          <View className="flex-row justify-center mb-4">
            <Pressable
              onPress={() => {
                setVisibility(
                  visibility === "public" ? "close_friends" : "public",
                );
                Haptics.selectionAsync();
              }}
              className="flex-row items-center gap-2 px-4 py-2 rounded-full"
              style={{
                backgroundColor:
                  visibility === "close_friends"
                    ? "rgba(252,37,58,0.15)"
                    : "rgba(255,255,255,0.08)",
                borderWidth: 1,
                borderColor:
                  visibility === "close_friends"
                    ? "rgba(252,37,58,0.4)"
                    : "rgba(255,255,255,0.1)",
              }}
            >
              {visibility === "public" ? (
                <Globe size={14} color="rgba(255,255,255,0.7)" />
              ) : (
                <Star size={14} color="#FC253A" fill="#FC253A" />
              )}
              <Text
                style={{
                  color:
                    visibility === "close_friends"
                      ? "#FC253A"
                      : "rgba(255,255,255,0.7)",
                  fontSize: 13,
                  fontWeight: "700",
                }}
              >
                {visibility === "public" ? "Everyone" : "Close Friends"}
              </Text>
            </Pressable>
          </View>

          <View className="flex-row justify-center gap-6">
            <Pressable
              onPress={handlePickLibrary}
              disabled={mediaAssets.length >= MAX_STORY_ITEMS || isSharing}
              className={`items-center gap-1 ${mediaAssets.length >= MAX_STORY_ITEMS || isSharing ? "opacity-40" : ""}`}
            >
              <View
                className="w-14 h-14 rounded-xl bg-card items-center justify-center"
                style={{ borderCurve: "continuous" }}
              >
                <ImageIcon size={24} color="#fff" />
              </View>
              <Text className="text-muted-foreground text-xs">
                Gallery{" "}
                {mediaAssets.length > 0
                  ? `(${mediaAssets.length}/${MAX_STORY_ITEMS})`
                  : ""}
              </Text>
            </Pressable>

            <Pressable
              onPress={handleOpenCamera}
              disabled={mediaAssets.length >= MAX_STORY_ITEMS || isSharing}
              className={`items-center gap-1 ${mediaAssets.length >= MAX_STORY_ITEMS || isSharing ? "opacity-40" : ""}`}
            >
              <View
                className="w-14 h-14 rounded-xl bg-card items-center justify-center"
                style={{ borderCurve: "continuous" }}
              >
                <Camera size={24} color="#fff" />
              </View>
              <Text className="text-muted-foreground text-xs">Camera</Text>
            </Pressable>

            <Pressable
              onPress={handleCreateTextStory}
              className="items-center gap-1"
            >
              <View
                className="w-14 h-14 rounded-xl bg-card items-center justify-center"
                style={{ borderCurve: "continuous" }}
              >
                <Type size={24} color="#fff" />
              </View>
              <Text className="text-muted-foreground text-xs">Text</Text>
            </Pressable>

            <Pressable
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setShowTagPicker(true);
              }}
              className="items-center gap-1"
            >
              <View
                className="w-14 h-14 rounded-xl items-center justify-center"
                style={{
                  borderCurve: "continuous",
                  backgroundColor:
                    taggedUsers.length > 0
                      ? "rgba(62,164,229,0.2)"
                      : colors.card,
                }}
              >
                <UserPlus
                  size={24}
                  color={taggedUsers.length > 0 ? "#3EA4E5" : "#fff"}
                />
              </View>
              <Text
                style={{
                  color:
                    taggedUsers.length > 0
                      ? "#3EA4E5"
                      : "rgba(255,255,255,0.5)",
                  fontSize: 12,
                }}
              >
                {taggedUsers.length > 0
                  ? `${taggedUsers.length} Tag`
                  : "Mention"}
              </Text>
            </Pressable>
          </View>
        </View>
      </ScrollView>

      {/* Tag People Picker */}
      <StoryTagPicker
        visible={showTagPicker}
        onClose={() => setShowTagPicker(false)}
        selectedUsers={taggedUsers}
        onUsersChanged={setTaggedUsers}
      />
    </>
  );
}

export default function CreateStoryScreen() {
  const router = useRouter();
  return (
    <ErrorBoundary screenName="StoryCreate" onGoBack={() => router.back()}>
      <CreateStoryScreenContent />
    </ErrorBoundary>
  );
}
