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
import { Progress } from "@dvnt/app/components/ui/progress";
import {
  LocationAutocompleteInstagram,
  type LocationData,
} from "@dvnt/app/components/ui/location-autocomplete-instagram";
import { useColorScheme } from "@dvnt/app/lib/hooks";
import { useMediaPicker } from "@dvnt/app/lib/hooks";
import type { MediaAsset } from "@dvnt/app/lib/hooks/use-media-picker";
import { useCreatePostStore } from "@dvnt/app/lib/stores/create-post-store";
import { useCreatePost } from "@dvnt/app/lib/hooks/use-posts";
import { postTagsApi } from "@dvnt/app/lib/api/post-tags";
import {
  TagPeopleSheet,
  type TagCandidate,
} from "@dvnt/app/components/tags/TagPeopleSheet";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import { useUIStore } from "@dvnt/app/lib/stores/ui-store";
import { useMediaUpload } from "@dvnt/app/lib/hooks/use-media-upload";
import { useCallback, useEffect, useRef, useState } from "react";
import { UserMentionAutocomplete } from "@dvnt/app/components/ui/user-mention-autocomplete";
import { Switch } from "react-native";
import { useCameraResultStore } from "@dvnt/app/lib/stores/camera-result-store";
import { setPendingCrop } from "@dvnt/app/src/crop/crop-utils";
import { TextPostSlidesComposer } from "@dvnt/app/components/post/TextPostSlidesComposer";
import {
  TEXT_POST_MAX_LENGTH,
  serializeTextSlidesForMutation,
} from "@dvnt/app/lib/posts/text-post";
import { AppTrace, getErrorMessage } from "@dvnt/app/lib/diagnostics/app-trace";

const { width: SCREEN_WIDTH } = Dimensions.get("window");
const MEDIA_PREVIEW_SIZE = (SCREEN_WIDTH - 48) / 2;
const ASPECT_RATIO = 4 / 5;

const MAX_PHOTOS = 10;

function CreateScreenContent() {
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
  const { mutate: createPost, isPending: isCreating } = useCreatePost();
  const isSubmittingRef = useRef(false);
  const [isSubmitLocked, setIsSubmitLocked] = useState(false);
  const { user } = useAuthStore();
  const showToast = useUIStore((s) => s.showToast);
  const { colors } = useColorScheme();
  const consumeCameraResult = useCameraResultStore((s) => s.consumeResult);
  const {
    uploadMultiple,
    isUploading,
    isCompressing,
    progress: uploadProgress,
    compressionProgress,
    statusMessage,
    cancelUpload,
  } = useMediaUpload({ folder: "posts" });

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
    const {
      selectedMedia: currentSelectedMedia,
      caption: currentCaption,
      textSlides: currentTextSlides,
      location: currentLocation,
      isNSFW: currentIsNSFW,
      tags: currentTags,
      placedTags: currentPlacedTags,
      postKind: currentPostKind,
      textTheme: currentTextTheme,
    } = useCreatePostStore.getState();
    const isTextSubmission = currentPostKind === "text";
    const trimmedCaption = currentCaption.trim();
    const normalizedTextSlides = currentTextSlides.map((slide) =>
      slide.content.trim(),
    );
    const startedAt = Date.now();

    console.log("[Create] handlePost called!");
    console.log("[Create] isUploading:", isUploading);
    console.log("[Create] isCreating:", isCreating);
    console.log("[Create] postKind:", currentPostKind);
    console.log("[Create] selectedMedia:", currentSelectedMedia.length);
    console.log("[Create] caption length:", trimmedCaption.length);

    // Prevent double submission — ref check is synchronous (survives rapid taps)
    if (isSubmittingRef.current || isSubmitLocked || isCreating || isUploading) {
      console.log("[Create] Already submitting, ignoring");
      AppTrace.warn("POST", "submit_blocked_inflight", {
        postKind: currentPostKind,
        isCreating,
        isUploading,
        submitLocked: isSubmitLocked,
      });
      return;
    }
    AppTrace.trace("POST", "submit_started", {
      postKind: currentPostKind,
      mediaCount: currentSelectedMedia.length,
      captionLength: trimmedCaption.length,
      tagCount: currentTags.length,
      hasLocation: Boolean(currentLocation),
      isNSFW: isTextSubmission ? false : currentIsNSFW,
    });
    isSubmittingRef.current = true;
    setIsSubmitLocked(true);

    if (!isTextSubmission && currentSelectedMedia.length === 0) {
      AppTrace.warn("POST", "submit_blocked_no_media", {
        postKind: currentPostKind,
      });
      showToast("error", "No Photos", "Please select at least one photo.");
      isSubmittingRef.current = false;
      setIsSubmitLocked(false);
      return;
    }

    if (
      isTextSubmission &&
      normalizedTextSlides.some((slide) => slide.length === 0)
    ) {
      AppTrace.warn("POST", "submit_blocked_empty_slide", {
        slideCount: normalizedTextSlides.length,
      });
      showToast(
        "error",
        "Empty Slide",
        "Each slide needs text before you can post.",
      );
      isSubmittingRef.current = false;
      setIsSubmitLocked(false);
      return;
    }

    if (
      isTextSubmission &&
      normalizedTextSlides.some((slide) => slide.length > TEXT_POST_MAX_LENGTH)
    ) {
      AppTrace.warn("POST", "submit_blocked_text_too_long", {
        slideCount: normalizedTextSlides.length,
      });
      showToast(
        "error",
        "Too Long",
        `Text posts are limited to ${TEXT_POST_MAX_LENGTH} characters.`,
      );
      isSubmittingRef.current = false;
      setIsSubmitLocked(false);
      return;
    }

    try {
      console.log("[Create] Starting post creation...");
      console.log(
        "[Create] Selected media count:",
        currentSelectedMedia.length,
      );

      // Upload media to Bunny.net CDN
      // Use editedUri if user explicitly edited, otherwise use original uri
      const mediaFiles = currentSelectedMedia.map((m) => {
        const uploadUri = m.editorOpened && m.editedUri ? m.editedUri : m.uri;
        if (__DEV__) {
          console.log("[MediaPipeline] UPLOAD:", {
            id: m.id,
            originalUri: m.uri.substring(0, 60),
            editedUri: m.editedUri?.substring(0, 60) ?? null,
            uploadUri: uploadUri.substring(0, 60),
            editorOpened: !!m.editorOpened,
            usingEdited: !!(m.editorOpened && m.editedUri),
          });
        }
        return {
          uri: uploadUri,
          type: m.type as "image" | "video",
          kind: m.kind,
          mimeType: m.mimeType,
          pairedVideoUri: m.pairedVideoUri,
        };
      });

      let postMedia: Array<{
        type: string;
        url: string;
        thumbnail?: string;
        mimeType?: string;
        livePhotoVideoUrl?: string;
      }> = [];

      if (!isTextSubmission) {
        console.log("[Create] Uploading media to CDN...");
        AppTrace.trace("POST", "media_upload_started", {
          mediaCount: mediaFiles.length,
          hasVideo: mediaFiles.some((item) => item.type === "video"),
        });
        let uploadResults;
        try {
          uploadResults = await uploadMultiple(mediaFiles);
          console.log(
            "[Create] Upload results:",
            JSON.stringify(uploadResults),
          );
        } catch (uploadError) {
          console.error("[Create] Upload threw error:", uploadError);
          AppTrace.error("POST", "media_upload_failed", {
            elapsedMs: Date.now() - startedAt,
            error: getErrorMessage(uploadError),
          });
          showToast(
            "error",
            "Upload Failed",
            "Could not upload media. Please try again.",
          );
          isSubmittingRef.current = false;
          setIsSubmitLocked(false);
          return;
        }

        const failedUploads = uploadResults.filter((r) => !r.success);
        if (failedUploads.length > 0) {
          console.error("[Create] Upload failures:", failedUploads);
          AppTrace.error("POST", "media_upload_partial_failure", {
            elapsedMs: Date.now() - startedAt,
            failedUploads: failedUploads.length,
          });
          showToast(
            "error",
            "Upload Error",
            `${failedUploads.length} file(s) failed to upload. Please try again.`,
          );
          isSubmittingRef.current = false;
          setIsSubmitLocked(false);
          return;
        }

        postMedia = uploadResults.map((r) => ({
          // DB posts_media.type only accepts "image" | "video".
          // Special kinds are distinguished via mimeType or livePhotoVideoUrl on read:
          //   gif           → type="image", mimeType="image/gif"
          //   livePhoto     → type="image", livePhotoVideoUrl=<url>
          //   animated_video → type="video", mimeType="video/mp4+animated"
          type: (r.kind === "animated_video" || r.kind === "video") ? "video" : "image",
          url: r.url,
          mimeType:
            r.kind === "gif" ? "image/gif"
            : r.kind === "animated_video" ? "video/mp4+animated"
            : (r.mimeType ?? undefined),
          ...(r.thumbnail && { thumbnail: r.thumbnail }),
          ...(r.livePhotoVideoUrl && { livePhotoVideoUrl: r.livePhotoVideoUrl }),
        }));
      }

      console.log("[Create] Creating post with CDN URLs:", postMedia);
      console.log("[Create] Author ID:", user?.id, "Username:", user?.username);

      const tagsString =
        currentTags.length > 0
          ? "\n" + currentTags.map((t) => `#${t}`).join(" ")
          : "";
      const fullContent = currentCaption + tagsString;
      const textSlidesWithTags = isTextSubmission
        ? normalizedTextSlides.map((slide, index) =>
            index === normalizedTextSlides.length - 1
              ? `${slide}${tagsString}`.trim()
              : slide,
          )
        : [];

      createPost(
        {
          kind: isTextSubmission ? "text" : "media",
          textTheme: currentTextTheme,
          content: isTextSubmission ? textSlidesWithTags[0] : fullContent,
          slides: isTextSubmission
            ? serializeTextSlidesForMutation(
                textSlidesWithTags.map((content, order) => ({
                  id: `draft-${order}`,
                  order,
                  content,
                })),
              )
            : undefined,
          location: currentLocation,
          media: postMedia,
          isNSFW: isTextSubmission ? false : currentIsNSFW,
        },
        {
          onSuccess: async (newPost) => {
            console.log("[Create] Post created successfully:", newPost?.id);
            AppTrace.trace("POST", "submit_success", {
              elapsedMs: Date.now() - startedAt,
              postKind: currentPostKind,
              mediaCount: postMedia.length,
              hasLocation: Boolean(currentLocation),
            });

            // Save placed tags to backend (fire-and-forget)
            if (
              !isTextSubmission &&
              newPost?.id &&
              currentPlacedTags.length > 0
            ) {
              try {
                await postTagsApi.addTags(
                  String(newPost.id),
                  currentPlacedTags.map((t) => ({
                    userId: t.userId,
                    x: t.x,
                    y: t.y,
                    mediaIndex: t.mediaIndex,
                  })),
                );
                console.log("[Create] Saved", placedTags.length, "tags");
              } catch (tagErr) {
                console.error("[Create] Failed to save tags:", tagErr);
              }
            }

            // No success toast — the user lands back on the feed where
            // their new post is already at the top (optimistic insert).
            reset();
            setSelectedTagUsers([]);
            router.back();
          },
          onError: (error: any) => {
            console.error("[Create] Failed to create post:", error);
            console.error(
              "[Create] Error details:",
              JSON.stringify(error, null, 2),
            );
            AppTrace.error("POST", "submit_failed", {
              elapsedMs: Date.now() - startedAt,
              error: getErrorMessage(error),
              postKind: currentPostKind,
            });
            isSubmittingRef.current = false;
            const errorMessage =
              error?.message ||
              error?.error?.message ||
              "Failed to create post. Please try again.";
            showToast("error", "Error", errorMessage);
            setIsSubmitLocked(false);
          },
        },
      );
    } catch (error) {
      console.error("[Create] Unexpected error:", error);
      AppTrace.error("POST", "submit_failed_unexpected", {
        elapsedMs: Date.now() - startedAt,
        error: getErrorMessage(error),
        postKind: currentPostKind,
      });
      isSubmittingRef.current = false;
      setIsSubmitLocked(false);
      showToast("error", "Error", "Something went wrong. Please try again.");
    }
  }, [
    isSubmitLocked,
    isUploading,
    isCreating,
    showToast,
    uploadMultiple,
    user?.id,
    user?.username,
    createPost,
    reset,
    router,
    setSelectedTagUsers,
  ]);

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

  return (
    <View className="flex-1 bg-background max-w-3xl w-full self-center">
      {/* Header — Close / Title / Post */}
      <View
        style={{
          paddingTop: insets.top,
          paddingHorizontal: 16,
          paddingBottom: 10,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          backgroundColor: "#000",
          borderBottomWidth: 1,
          borderBottomColor: "rgba(255,255,255,0.06)",
        }}
      >
        <Pressable
          onPress={handleClose}
          hitSlop={12}
          style={{
            width: 44,
            height: 44,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <X size={24} color="#fff" />
        </Pressable>
        <Text style={{ color: "#fff", fontSize: 17, fontWeight: "700" }}>
          New Post
        </Text>
        <Pressable
          onPress={handlePost}
          disabled={!isValid || isCreating || isUploading || isSubmitLocked}
          hitSlop={12}
          style={{
            paddingHorizontal: 18,
            paddingVertical: 8,
            borderRadius: 20,
            backgroundColor:
              isValid && !isCreating && !isUploading && !isSubmitLocked
                ? "#3EA4E5"
                : "rgba(255,255,255,0.08)",
          }}
        >
          <Text
            style={{
              color:
                isValid && !isCreating && !isUploading && !isSubmitLocked
                  ? "#fff"
                  : "rgba(255,255,255,0.3)",
              fontSize: 15,
              fontWeight: "700",
            }}
          >
            {isCreating || isSubmitLocked ? "Posting..." : "Post"}
          </Text>
        </Pressable>
      </View>

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

      {/* Progress Overlay */}
      {isUploading && (
        <View className="absolute inset-0 bg-black/80 items-center justify-center z-50">
          <Motion.View
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: "spring", damping: 20, stiffness: 300 }}
            className="bg-card rounded-3xl p-8 items-center gap-4 min-w-[280px]"
          >
            {/* Show compression progress when compressing */}
            {isCompressing && (
              <>
                <View className="w-48 mb-2">
                  <Progress value={compressionProgress} />
                </View>
                <Text className="text-lg font-semibold text-foreground">
                  Compressing Video...
                </Text>
                <Text className="text-sm text-muted-foreground text-center">
                  {compressionProgress}% complete
                </Text>
              </>
            )}
            {/* Show upload progress when not compressing */}
            {!isCompressing && (
              <>
                <View className="w-48 mb-2">
                  <Progress value={uploadProgress} />
                </View>
                <Text className="text-lg font-semibold text-foreground">
                  {statusMessage || "Posting..."}
                </Text>
                <Text className="text-sm text-muted-foreground text-center">
                  {uploadProgress}% complete
                </Text>
              </>
            )}
            <Pressable
              onPress={cancelUpload}
              hitSlop={12}
              style={{
                marginTop: 8,
                paddingHorizontal: 24,
                paddingVertical: 10,
                borderRadius: 20,
                backgroundColor: "rgba(255,255,255,0.08)",
              }}
            >
              <Text style={{ color: "#999", fontSize: 14, fontWeight: "600" }}>
                Cancel
              </Text>
            </Pressable>
          </Motion.View>
        </View>
      )}
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
