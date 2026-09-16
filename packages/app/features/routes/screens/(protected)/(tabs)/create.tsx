import {
  View,
  Text,
  Pressable,
  TextInput,
  Alert,
  Dimensions,
} from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { Image } from "expo-image";
import { DVNTGifView } from "@dvnt/app/components/media/DVNTGifView";
import { DVNTAnimatedVideoView } from "@dvnt/app/components/media/DVNTAnimatedVideoView";
import {
  X,
  Image as ImageIcon,
  Camera,
  Trash2,
  Plus,
  Hash,
  UserPlus,
  Scissors,
  Type,
  CalendarPlus,
} from "lucide-react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { ErrorBoundary } from "@dvnt/app/components/error-boundary";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Motion } from "@legendapp/motion";
import {
  LocationAutocompleteInstagram,
  type LocationData,
} from "@dvnt/app/components/ui/location-autocomplete-instagram";
import { useColorScheme } from "@dvnt/app/lib/hooks";
import { useMediaPicker } from "@dvnt/app/lib/hooks";
import type { MediaAsset } from "@dvnt/app/lib/hooks/use-media-picker";
import { useCreatePostStore } from "@dvnt/app/lib/stores/create-post-store";
import { useCreateHeaderStore } from "@dvnt/app/lib/stores/create-header-store";
import { useTabBarTopInset } from "@dvnt/app/lib/hooks/use-tab-bar-inset";
import { usePublishPost } from "@dvnt/app/lib/hooks/use-publish-post";
import { assertFirstPostPublishable } from "@dvnt/app/lib/posts/first-post-event";
import { useFirstPostOfferStore } from "@dvnt/app/lib/stores/first-post-offer-store";
import {
  TagPeopleSheet,
  type TagCandidate,
} from "@dvnt/app/features/tags";
import { useUIStore } from "@dvnt/app/lib/stores/ui-store";
import { useCallback, useEffect, useRef, useState } from "react";
import { UserMentionAutocomplete } from "@dvnt/app/components/ui/user-mention-autocomplete";
import { Switch } from "react-native";
import { useCameraResultStore } from "@dvnt/app/lib/stores/camera-result-store";
import { setPendingCrop } from "@dvnt/app/features/crop/crop-utils";
import Logo from "@dvnt/app/components/logo";
import { TextPostSlidesComposer } from "@dvnt/app/features/post";
import {
  TEXT_POST_MAX_LENGTH,
} from "@dvnt/app/lib/posts/text-post";
import { AppTrace } from "@dvnt/app/lib/diagnostics/app-trace";
import { useResponsiveGrid } from "@dvnt/app/lib/hooks/use-responsive-grid";

const { width: SCREEN_WIDTH } = Dimensions.get("window");
/**
 * Was `(SCREEN_WIDTH - 48) / 2` off a module-scope Dimensions read, so the
 * previews kept the width the app launched at and a rotation left them the
 * wrong size. Read per-render below.
 */
const MIN_MEDIA_PREVIEW = 150;
const ASPECT_RATIO = 4 / 5;

const MAX_PHOTOS = 10;

function CreateScreenContent() {
  // Media previews scale with the window instead of the launch width.
  const { cellWidth: MEDIA_PREVIEW_SIZE } = useResponsiveGrid({
    minCellWidth: MIN_MEDIA_PREVIEW,
    gap: 16,
    horizontalPadding: 48,
    maxColumns: 4,
  });
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const {
    caption,
    textSlides,
    activeTextSlideIndex,
    location,
    isNSFW,
    tags,
    postKind,
    textTheme,
    setCaption,
    setActiveTextSlideIndex,
    updateTextSlide,
    addTextSlide,
    removeTextSlide,
    setLocationData,
    setIsNSFW,
    setPostKind,
    setTextTheme,
    addTag,
    removeTag,
    reset,
  } = useCreatePostStore();
  const { selectedMedia, setSelectedMedia, placedTags, setPlacedTags } =
    useCreatePostStore();
  const [tagInput, setTagInput] = useState("");
  const [showTagSheet, setShowTagSheet] = useState(false);
  const [selectedTagUsers, setSelectedTagUsers] = useState<TagCandidate[]>([]);
  const { pickFromLibrary } = useMediaPicker();
  const publishPost = usePublishPost();
  const isSubmittingRef = useRef(false);
  const [isSubmitLocked, setIsSubmitLocked] = useState(false);
  const showToast = useUIStore((s) => s.showToast);
  const { colors } = useColorScheme();
  const consumeCameraResult = useCameraResultStore((s) => s.consumeResult);


  const canAddMore = selectedMedia.length < MAX_PHOTOS;
  const isTextPost = postKind === "text";
  const activeTextSlide = textSlides[activeTextSlideIndex] ?? textSlides[0];
  const hasTextDraft = textSlides.some(
    (slide) => slide.content.trim().length > 0,
  );
  const areTextSlidesValid =
    textSlides.length > 0 &&
    textSlides.every(
      (slide) =>
        slide.content.trim().length > 0 &&
        slide.content.trim().length <= TEXT_POST_MAX_LENGTH,
    );

  const isValid = isTextPost
    ? areTextSlidesValid
    : selectedMedia.length > 0;

  const MAX_ANIMATED_VIDEO_DURATION = 15; // seconds — below this, video posts as a muted autoplay loop

  const validateMedia = useCallback(
    (media: MediaAsset[]): MediaAsset[] => {
      const validMedia: MediaAsset[] = [];

      for (const item of media) {
        if (item.type === "video") {
          const duration = item.duration ?? 0;
          if (duration <= MAX_ANIMATED_VIDEO_DURATION && duration > 0) {
            // Short clip → animated loop (muted, autoplaying in feed)
            validMedia.push({ ...item, kind: "animated_video" });
          } else {
            // Full video → regular video post with playback controls
            validMedia.push(item);
          }
          continue;
        }

        if (selectedMedia.length + validMedia.length >= MAX_PHOTOS) {
          showToast("warning", "Photo limit reached", `You can add up to ${MAX_PHOTOS} photos per post.`);
          break;
        }

        validMedia.push(item);
      }

      return validMedia;
    },
    [selectedMedia.length, showToast],
  );

  const handlePickLibrary = async () => {
    if (!canAddMore) {
      showToast("warning", "Photo limit", `Maximum ${MAX_PHOTOS} photos per post.`);
      return;
    }

    const remaining = MAX_PHOTOS - selectedMedia.length;

    const media = await pickFromLibrary({
      maxSelection: remaining,
      allowsMultipleSelection: true,
      mediaTypes: ["images", "videos", "livePhotos"],
    });

    if (media && media.length > 0) {
      const validMedia = validateMedia(media);
      if (validMedia.length > 0) {
        // All media (images AND videos) go directly to composer.
        // No automatic crop/editor navigation.
        // The crop/editor is ONLY opened via explicit edit button on thumbnails.
        setSelectedMedia([...selectedMedia, ...validMedia]);

        if (__DEV__) {
          for (const m of validMedia) {
            console.log("[MediaPipeline] IMPORTED (library):", {
              id: m.id,
              uri: m.uri.substring(0, 60),
              type: m.type,
              width: m.width,
              height: m.height,
              editorOpened: false,
              cropState: null,
            });
          }
        }
      }
    }
  };

  // Consume camera result when returning from camera screen
  useFocusEffect(
    useCallback(() => {
      isSubmittingRef.current = false;
      setIsSubmitLocked(false);
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
        const validMedia = validateMedia([media]);
        if (validMedia.length > 0) {
          // All camera results go directly to composer.
          // No automatic crop/editor navigation.
          setSelectedMedia([...selectedMedia, ...validMedia]);

          if (__DEV__) {
            console.log("[MediaPipeline] IMPORTED (camera):", {
              uri: result.uri.substring(0, 60),
              type: result.type,
              width: result.width,
              height: result.height,
              editorOpened: false,
              cropState: null,
            });
          }
        }
      }
    }, [consumeCameraResult, validateMedia, selectedMedia, setSelectedMedia]),
  );

  const handleOpenCamera = () => {
    if (selectedMedia.length >= MAX_PHOTOS) {
      showToast("warning", "Photo limit", `Maximum ${MAX_PHOTOS} photos per post.`);
      return;
    }
    router.push({
      pathname: "/(protected)/camera",
      params: { mode: "photo", source: "post" },
    });
  };

  const handleRemoveMedia = (id: string) => {
    setSelectedMedia(selectedMedia.filter((m) => m.id !== id));
  };

  const handleSetPostKind = useCallback(
    (nextKind: "media" | "text") => {
      if (nextKind === postKind) return;
      AppTrace.trace("POST", "composer_kind_changed", {
        kind: nextKind,
      });
      setPostKind(nextKind);
      if (nextKind === "text") {
        if (selectedMedia.length > 0) {
          setSelectedMedia([]);
        }
        if (placedTags.length > 0) {
          setPlacedTags([]);
        }
        setSelectedTagUsers([]);
        if (isNSFW) {
          setIsNSFW(false);
        }
      }
    },
    [
      isNSFW,
      placedTags.length,
      postKind,
      selectedMedia.length,
      setIsNSFW,
      setPlacedTags,
      setPostKind,
      setSelectedMedia,
    ],
  );

  const handlePost = useCallback(async () => {
    if (isSubmittingRef.current) return;
    isSubmittingRef.current = true;
    setIsSubmitLocked(true);
    try {
      // An event-linked draft can sit here for days. Its visibility is checked
      // again against the server now, not trusted from when it was written.
      await assertFirstPostPublishable();
      publishPost(useCreatePostStore.getState());
      useFirstPostOfferStore.getState().clearPending();
      reset();
      setSelectedTagUsers([]);
      setTagInput("");
      router.replace("/(protected)/(tabs)");
    } catch (error) {
      showToast("error", "Could not share", error instanceof Error ? error.message : "Please try again.");
    } finally {
      isSubmittingRef.current = false;
      setIsSubmitLocked(false);
    }
  }, [publishPost, reset, router, showToast]);

  const handleClose = () => {
    if (selectedMedia.length > 0 || caption.length > 0 || hasTextDraft) {
      Alert.alert(
        "Discard Post?",
        "You have unsaved changes. Are you sure you want to discard this post?",
        [
          { text: "Keep Editing", style: "cancel" },
          {
            text: "Discard",
            style: "destructive",
            onPress: () => {
              reset();
              router.back();
            },
          },
        ],
      );
    } else {
      router.back();
    }
  };

  // Publish this screen's header actions to the layout, which draws them in the
  // Stack header slot above the tab bar — the same place every other tab's
  // header lives. Cleared on unmount so a stale Post handler can never fire.
  // iPad puts the tab bar at the TOP, over the content.
  const tabBarTopInset = useTabBarTopInset();
  const registerHeader = useCreateHeaderStore((s) => s.register);
  const resetHeader = useCreateHeaderStore((s) => s.reset);
  const canPost = isValid && !isSubmitLocked;
  useEffect(() => {
    registerHeader({
      canPost,
      postLabel: isSubmitLocked ? "Posting..." : "Post",
      onClose: handleClose,
      onPost: handlePost,
    });
  }, [canPost, isSubmitLocked, handleClose, handlePost, registerHeader]);
  useEffect(() => () => resetHeader(), [resetHeader]);

  return (
    <View
      className="flex-1 bg-background w-full"
      style={{ paddingTop: tabBarTopInset }}
    >
      {/* Full-bleed canvas, centred composer — same rule as the other tabs. */}
      <View className="flex-1 w-full max-w-3xl self-center">
      <KeyboardAwareScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ flexGrow: 1, paddingBottom: 100 }}
        showsVerticalScrollIndicator={false}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        bottomOffset={100}
        enabled={true}
      >
        <View style={{ paddingHorizontal: 16, paddingTop: 16 }}>
          <View
            style={{
              flexDirection: "row",
              gap: 10,
              padding: 6,
              borderRadius: 18,
              backgroundColor: "#0E1320",
              borderWidth: 1,
              borderColor: "rgba(255,255,255,0.08)",
            }}
          >
            {[
              {
                key: "media",
                label: "Media",
                icon: ImageIcon,
                description: "Photos or video",
              },
              {
                key: "text",
                label: "Text",
                icon: Type,
                description: "Text only",
              },
              {
                key: "event",
                label: "Event",
                icon: CalendarPlus,
                description: "Party, meetup, etc.",
              },
            ].map((option) => {
              const Icon = option.icon;
              const isActive = postKind === option.key;
              return (
                <Pressable
                  key={option.key}
                  onPress={() => {
                    if (option.key === "event") {
                      router.push("/(protected)/events/create" as any);
                    } else {
                      handleSetPostKind(option.key as "media" | "text");
                    }
                  }}
                  style={{
                    flex: 1,
                    borderRadius: 14,
                    paddingHorizontal: 8,
                    paddingVertical: 14,
                    backgroundColor: isActive
                      ? "rgba(62,164,229,0.16)"
                      : "transparent",
                    borderWidth: 1,
                    borderColor: isActive
                      ? "rgba(62,164,229,0.42)"
                      : "transparent",
                  }}
                >
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 8,
                    }}
                  >
                    <Icon size={18} color={isActive ? "#6BC5FF" : "#8B95A7"} />
                    <Text
                      style={{
                        color: isActive ? "#fff" : "#C2CAD7",
                        fontSize: 15,
                        fontWeight: "700",
                        flex: 1,
                      }}
                    >
                      {option.label}
                    </Text>
                  </View>
                  <Text
                    style={{
                      marginTop: 8,
                      color: isActive
                        ? "rgba(226,232,240,0.84)"
                        : "rgba(148,163,184,0.68)",
                      fontSize: 12,
                      lineHeight: 16,
                    }}
                  >
                    {option.description}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        {/* Meta block — Add tag, Add Photos/Camera, Add location.
            Lifted above the per-mode content (text composer / media
            preview / caption) so this stays in the same spot whether
            the user is on the Media tab or the Text tab. */}
        <View style={{ paddingHorizontal: 16, paddingTop: 16 }}>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 8,
            }}
          >
            <View
              style={{
                flex: 1,
                flexDirection: "row",
                alignItems: "center",
                backgroundColor: "#111",
                borderRadius: 10,
                borderWidth: 1,
                borderColor: "#333",
                paddingHorizontal: 12,
                height: 44,
              }}
            >
              <Hash size={16} color="#8A40CF" strokeWidth={2.5} />
              <TextInput
                value={tagInput}
                onChangeText={(t) => setTagInput(t.replace(/\s/g, ""))}
                placeholder="Add tag"
                placeholderTextColor="#666"
                style={{
                  flex: 1,
                  color: "#fff",
                  fontSize: 15,
                  marginLeft: 6,
                }}
                returnKeyType="done"
                onSubmitEditing={() => {
                  if (tagInput.trim()) {
                    addTag(tagInput);
                    setTagInput("");
                  }
                }}
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>
            <Pressable
              onPress={() => {
                if (tagInput.trim()) {
                  addTag(tagInput);
                  setTagInput("");
                }
              }}
              style={{
                backgroundColor: tagInput.trim() ? "#8A40CF" : "#333",
                height: 44,
                paddingHorizontal: 16,
                borderRadius: 10,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Text style={{ color: "#fff", fontWeight: "600", fontSize: 14 }}>
                Add
              </Text>
            </Pressable>
          </View>
          {tags.length > 0 && (
            <View
              style={{
                flexDirection: "row",
                flexWrap: "wrap",
                gap: 6,
                marginTop: 10,
              }}
            >
              {tags.map((tag) => (
                <Pressable
                  key={tag}
                  onPress={() => removeTag(tag)}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 4,
                    backgroundColor: "rgba(138, 64, 207, 0.12)",
                    paddingHorizontal: 10,
                    paddingVertical: 6,
                    borderRadius: 100,
                    borderWidth: 1,
                    borderColor: "rgba(138, 64, 207, 0.25)",
                  }}
                >
                  <Hash size={11} color="#8A40CF" strokeWidth={2.5} />
                  <Text
                    style={{
                      color: "#8A40CF",
                      fontSize: 13,
                      fontWeight: "600",
                    }}
                  >
                    {tag}
                  </Text>
                  <X size={12} color="#8A40CF" style={{ marginLeft: 2 }} />
                </Pressable>
              ))}
            </View>
          )}
        </View>

        {!isTextPost && selectedMedia.length === 0 && (
          <View
            style={{
              flexDirection: "row",
              paddingHorizontal: 16,
              paddingTop: 12,
              gap: 8,
            }}
          >
            <Pressable
              onPress={handlePickLibrary}
              style={{
                flex: 1,
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                backgroundColor: "#3EA4E5",
                paddingVertical: 14,
                borderRadius: 12,
              }}
            >
              <ImageIcon size={20} color="#fff" />
              <Text style={{ color: "#fff", fontWeight: "600" }}>
                Add Photos
              </Text>
            </Pressable>
            <Pressable
              onPress={handleOpenCamera}
              style={{
                flex: 1,
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                backgroundColor: "#1a1a1a",
                borderWidth: 1,
                borderColor: "#333",
                paddingVertical: 14,
                borderRadius: 12,
              }}
            >
              <Camera size={20} color="#fff" />
              <Text style={{ color: "#fff", fontWeight: "600" }}>Camera</Text>
            </Pressable>
          </View>
        )}

        <View style={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4 }}>
          <LocationAutocompleteInstagram
            value={location}
            placeholder="Add location"
            onLocationSelect={(data: LocationData) => setLocationData(data)}
            onClear={() => setLocationData(null)}
            onTextChange={(text) => {
              if (!text) {
                setLocationData(null);
              }
            }}
          />
        </View>

        {isTextPost && (
          <TextPostSlidesComposer
            slides={textSlides}
            activeIndex={activeTextSlideIndex}
            theme={textTheme}
            onSelectSlide={setActiveTextSlideIndex}
            onSlideChange={updateTextSlide}
            onAddSlide={addTextSlide}
            onRemoveSlide={removeTextSlide}
            onThemeChange={setTextTheme}
          />
        )}

        {/*
          Tag People + Location + photos sections render BELOW the primary
          content area so the order matches the text-mode layout (content
          → metadata). The Tag People button still gates on selected media
          since photo-tagging requires photos.
        */}

        {/* Tag People Button */}
        {!isTextPost && selectedMedia.length > 0 && (
          <Pressable
            onPress={() => setShowTagSheet(true)}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 10,
              paddingHorizontal: 16,
              paddingVertical: 14,
              marginHorizontal: 16,
              marginBottom: 16,
              backgroundColor: "#111",
              borderRadius: 12,
              borderWidth: 1,
              borderColor: placedTags.length > 0 ? "#FF5BFC" : "#333",
            }}
          >
            <UserPlus
              size={18}
              color={placedTags.length > 0 ? "#FF5BFC" : "#999"}
            />
            <Text
              style={{
                color: "#fff",
                fontSize: 15,
                fontWeight: "500",
                flex: 1,
              }}
            >
              {placedTags.length > 0
                ? `${placedTags.length} ${placedTags.length === 1 ? "person" : "people"} tagged`
                : "Tag People"}
            </Text>
            {placedTags.length > 0 && (
              <Pressable
                onPress={() => {
                  setPlacedTags([]);
                  setSelectedTagUsers([]);
                }}
                hitSlop={12}
              >
                <X size={16} color="#999" />
              </Pressable>
            )}
          </Pressable>
        )}

        {/* Content Rating Toggle */}
        {!isTextPost && selectedMedia.length > 0 && (
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              paddingHorizontal: 16,
              paddingVertical: 12,
              marginBottom: 16,
              backgroundColor: isNSFW
                ? "rgba(239, 68, 68, 0.1)"
                : "transparent",
              borderRadius: 12,
              marginHorizontal: 16,
              borderWidth: 1,
              borderColor: isNSFW ? "rgba(239, 68, 68, 0.3)" : "#333",
            }}
          >
            <View
              style={{ flex: 1, flexDirection: "row", alignItems: "center" }}
            >
              <Text style={{ fontSize: 20, marginRight: 8 }}>
                {isNSFW ? "😈" : "😇"}
              </Text>
              <View>
                <Text
                  style={{
                    color: isNSFW ? "#ef4444" : "#fff",
                    fontWeight: "600",
                    fontSize: 15,
                  }}
                >
                  {isNSFW ? "Spicy" : "Sweet"}
                </Text>
                <Text style={{ color: "#666", fontSize: 12, marginTop: 2 }}>
                  {isNSFW ? "Mature content warning" : "All audiences"}
                </Text>
              </View>
            </View>
            <Switch
              value={isNSFW}
              onValueChange={setIsNSFW}
              trackColor={{ false: "#333", true: "#ef4444" }}
              thumbColor={isNSFW ? "#fff" : "#888"}
            />
          </View>
        )}

        {!isTextPost && selectedMedia.length > 0 && (
          <View style={{ paddingHorizontal: 16, paddingBottom: 32 }}>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
              {selectedMedia.map((media, index) => (
                <View
                  key={media.id}
                  style={{
                    width: MEDIA_PREVIEW_SIZE,
                    aspectRatio: ASPECT_RATIO,
                    borderRadius: 12,
                    overflow: "hidden",
                    backgroundColor: "#111",
                  }}
                >
                  {media.kind === "gif" ? (
                    <DVNTGifView
                      key={media.uri}
                      uri={media.uri}
                      width="100%"
                      height="100%"
                      contentFit="cover"
                      isPlaying
                    />
                  ) : media.kind === "animated_video" ? (
                    <DVNTAnimatedVideoView
                      key={media.uri}
                      uri={media.uri}
                      width="100%"
                      height="100%"
                      contentFit="cover"
                      isPlaying
                    />
                  ) : (
                    <Image
                      key={media.uri}
                      source={{ uri: media.uri }}
                      style={{ width: "100%", height: "100%" }}
                      contentFit="cover"
                      cachePolicy="memory-disk"
                    />
                  )}

                  <View
                    style={{
                      position: "absolute",
                      top: 8,
                      right: 8,
                      backgroundColor: "rgba(0,0,0,0.7)",
                      width: 24,
                      height: 24,
                      borderRadius: 12,
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Text
                      style={{ color: "#fff", fontSize: 12, fontWeight: "600" }}
                    >
                      {index + 1}
                    </Text>
                  </View>

                  <Pressable
                    onPress={() => handleRemoveMedia(media.id)}
                    style={{
                      position: "absolute",
                      top: 8,
                      left: 8,
                      backgroundColor: "rgba(240,82,82,0.9)",
                      width: 28,
                      height: 28,
                      borderRadius: 14,
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                    hitSlop={12}
                  >
                    <Trash2 size={14} color="#fff" />
                  </Pressable>

                  {/* Re-crop button for images */}
                  {media.type === "image" && (
                    <Pressable
                      onPress={() => {
                        setPendingCrop([media], 0);
                        router.push("/(protected)/crop-preview" as any);
                      }}
                      style={{
                        position: "absolute",
                        bottom: 8,
                        right: 8,
                        backgroundColor: "rgba(0,0,0,0.7)",
                        width: 28,
                        height: 28,
                        borderRadius: 14,
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                      hitSlop={12}
                    >
                      <Scissors size={14} color="#fff" />
                    </Pressable>
                  )}
                </View>
              ))}

              {canAddMore && (
                <Pressable
                  onPress={handlePickLibrary}
                  style={{
                    width: MEDIA_PREVIEW_SIZE,
                    aspectRatio: ASPECT_RATIO,
                    borderRadius: 12,
                    backgroundColor: "#111",
                    borderWidth: 2,
                    borderColor: "#333",
                    borderStyle: "dashed",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Plus size={32} color="#666" />
                  <Text style={{ color: "#666", fontSize: 12, marginTop: 4 }}>
                    Add More
                  </Text>
                </Pressable>
              )}
            </View>
          </View>
        )}

        {/* Caption — below media for media posts */}
        {!isTextPost && (
          <View style={{ padding: 16 }}>
            <UserMentionAutocomplete
              value={caption}
              onChangeText={setCaption}
              placeholder="Caption (optional)"
              multiline
              maxLength={2200}
              style={{
                fontSize: 16,
                minHeight: 80,
              }}
            />
            <Text
              style={{
                fontSize: 12,
                color: "#666",
                marginTop: 6,
                textAlign: "right",
              }}
            >
              {caption.length}/2200
            </Text>
          </View>
        )}
      </KeyboardAwareScrollView>

      {/* Tag People Sheet */}
      <TagPeopleSheet
        visible={showTagSheet}
        onClose={() => setShowTagSheet(false)}
        selectedUsers={selectedTagUsers}
        onSelectionChange={(users: TagCandidate[]) => {
          setSelectedTagUsers(users);
          // Convert selected users to placed tags at default center position
          const newPlacedTags = users.map((u) => ({
            userId: u.id,
            username: u.username,
            avatar: u.avatar,
            x: 0.5,
            y: 0.5,
            mediaIndex: 0,
          }));
          setPlacedTags(newPlacedTags);
        }}
      />


      </View>
    </View>
  );
}

export default function CreateScreen() {
  return (
    <ErrorBoundary screenName="Create">
      <CreateScreenContent />
    </ErrorBoundary>
  );
}
