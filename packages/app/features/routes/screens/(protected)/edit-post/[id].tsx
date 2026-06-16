/**
 * Edit Post Screen
 *
 * Production-ready post editor with:
 * - Authorization guard (only post author)
 * - Media carousel preview (read-only)
 * - Caption editor with character counter
 * - Location editor
 * - Optimistic TanStack Query mutation with rollback
 * - NativeWind dark theme, Motion animations
 * - Unsaved changes detection
 * - Keyboard-safe scrolling
 *
 * Route: /(protected)/edit-post/[id]
 */

import {
  View,
  Text,
  Pressable,
  ActivityIndicator,
  Dimensions,
  Alert,
  ScrollView as RNScrollView,
  Switch,
} from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { ErrorBoundary } from "@dvnt/app/components/error-boundary";
import { resolveTextPostPresentation } from "@dvnt/app/lib/posts/text-post";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { Image } from "expo-image";
import {
  ArrowLeft,
  Check,
  MapPin,
  X,
  AlertCircle,
  ImageIcon,
  Play,
  Flame,
} from "lucide-react-native";
import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { Motion } from "@legendapp/motion";
import * as Haptics from "expo-haptics";
import {
  LocationAutocompleteInstagram,
  type LocationData,
} from "@dvnt/app/components/ui/location-autocomplete-instagram";
import { UserMentionAutocomplete } from "@dvnt/app/components/ui/user-mention-autocomplete";
import { ImageTagger } from "@dvnt/app/components/post/image-tagger";
import { usePost, postKeys } from "@dvnt/app/lib/hooks/use-posts";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import { useUIStore } from "@dvnt/app/lib/stores/ui-store";
import { postsApi } from "@dvnt/app/lib/api/posts";
import { postTagsApi, type PostTag } from "@dvnt/app/lib/api/post-tags";
import { useMutation, useQueryClient, useQuery } from "@tanstack/react-query";
import type { Post } from "@dvnt/app/lib/types";
import * as ImageManipulator from "expo-image-manipulator";
import { uploadToServer } from "@dvnt/app/lib/server-upload";

const { width: SCREEN_WIDTH } = Dimensions.get("window");
const MEDIA_HEIGHT = SCREEN_WIDTH * 0.65;
const MAX_CAPTION = 2200;

function EditPostScreenContent() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const showToast = useUIStore((s) => s.showToast);
  const currentUser = useAuthStore((s) => s.user);
  const scrollRef = useRef<RNScrollView>(null);

  // ─── Fetch post ───
  const { data: post, isLoading, isError } = usePost(id || "");

  // ─── Local form state ───
  const [caption, setCaption] = useState("");
  const [originalCaption, setOriginalCaption] = useState("");
  const [location, setLocation] = useState<LocationData | null>(null);
  const [originalLocation, setOriginalLocation] = useState<LocationData | null>(
    null,
  );
  const [isNSFW, setIsNSFW] = useState(false);
  const [originalIsNSFW, setOriginalIsNSFW] = useState(false);
  const [mediaIndex, setMediaIndex] = useState(0);
  const [rotations, setRotations] = useState<Record<number, number>>({});
  const [isRotating, setIsRotating] = useState(false);

  // ─── Post tags (Instagram-style) ───
  const { data: postTags = [], refetch: refetchTags } = useQuery({
    queryKey: ["postTags", id],
    queryFn: () => postTagsApi.getTagsForPost(id!),
    enabled: !!id,
  });

  const handleTagsChanged = useCallback(
    (tags: PostTag[]) => {
      refetchTags();
    },
    [refetchTags],
  );

  // Initialize form from post data
  useEffect(() => {
    if (post) {
      const nextCaption =
        post.kind === "text"
          ? resolveTextPostPresentation(post.textSlides, post.caption).previewText
          : post.caption || "";
      setCaption(nextCaption);
      setOriginalCaption(nextCaption);
      setLocation(post.location ? { name: post.location } : null);
      setOriginalLocation(post.location ? { name: post.location } : null);
      setIsNSFW(post.isNSFW || false);
      setOriginalIsNSFW(post.isNSFW || false);
    }
  }, [post]);

  // ─── Dirty detection ───
  const hasRotations = Object.values(rotations).some((r) => r % 360 !== 0);
  const isDirty = useMemo(
    () =>
      caption !== originalCaption ||
      location?.name !== originalLocation?.name ||
      isNSFW !== originalIsNSFW ||
      hasRotations,
    [
      caption,
      originalCaption,
      location,
      originalLocation,
      isNSFW,
      originalIsNSFW,
      hasRotations,
    ],
  );

  const captionOverLimit = caption.length > MAX_CAPTION;

  // ─── Authorization guard ───
  const isOwner = useMemo(() => {
    if (!post?.author?.username || !currentUser?.username) return false;
    return (
      post.author.username.toLowerCase() === currentUser.username.toLowerCase()
    );
  }, [post?.author?.username, currentUser?.username]);

  // ─── Optimistic mutation ───
  const updateMutation = useMutation({
    mutationFn: (updates: {
      content?: string;
      location?: string | undefined;
      isNSFW?: boolean;
    }) =>
      postsApi.updatePost(id!, {
        content: updates.content,
        location: updates.location,
        isNSFW: updates.isNSFW,
      }),

    onMutate: async (updates) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: postKeys.detail(id!) });
      await queryClient.cancelQueries({ queryKey: postKeys.feedInfinite() });

      // Snapshot previous values
      const previousPost = queryClient.getQueryData<Post>(postKeys.detail(id!));
      const previousFeed = queryClient.getQueryData(postKeys.feedInfinite());

      // Optimistic update — post detail
      queryClient.setQueryData<Post | null>(postKeys.detail(id!), (old) => {
        if (!old) return old;
        return {
          ...old,
          caption: updates.content ?? old.caption,
          location: updates.location ?? old.location,
        };
      });

      // Optimistic update — infinite feed
      queryClient.setQueryData(postKeys.feedInfinite(), (old: any) => {
        if (!old?.pages) return old;
        return {
          ...old,
          pages: old.pages.map((page: any) => ({
            ...page,
            data: page.data?.map((p: any) =>
              p.id === id
                ? {
                    ...p,
                    caption: updates.content ?? p.caption,
                    location: updates.location ?? p.location,
                  }
                : p,
            ),
          })),
        };
      });

      // Optimistic update — profile posts
      if (currentUser?.username) {
        queryClient.setQueryData(
          postKeys.profilePosts(currentUser.username),
          (old: any) => {
            if (!old || !Array.isArray(old)) return old;
            return old.map((p: any) =>
              p.id === id
                ? {
                    ...p,
                    caption: updates.content ?? p.caption,
                    location: updates.location ?? p.location,
                  }
                : p,
            );
          },
        );
      }

      return { previousPost, previousFeed };
    },

    onError: (_err, _vars, context) => {
      // Rollback
      if (context?.previousPost) {
        queryClient.setQueryData(postKeys.detail(id!), context.previousPost);
      }
      if (context?.previousFeed) {
        queryClient.setQueryData(postKeys.feedInfinite(), context.previousFeed);
      }
      showToast("error", "Error", "Couldn't save changes. Try again.");
    },

    onSuccess: () => {
      // Sync server state in background
      queryClient.invalidateQueries({ queryKey: postKeys.detail(id!) });
    },
  });

  // ─── Save handler ───
  const handleSave = useCallback(async () => {
    if (
      !id ||
      !isDirty ||
      captionOverLimit ||
      updateMutation.isPending ||
      isRotating
    )
      return;

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    const updates: {
      content?: string;
      location?: string;
      isNSFW?: boolean;
      media?: Array<{ order: number; url: string }>;
    } = {
      content: caption.trim(),
      location: location?.name || undefined,
      ...(isNSFW !== originalIsNSFW ? { isNSFW } : {}),
    };

    // Process rotated images: manipulate → upload → collect new URLs
    if (hasRotations && post?.media) {
      setIsRotating(true);
      try {
        const mediaUpdates: Array<{ order: number; url: string }> = [];

        for (const [indexStr, degrees] of Object.entries(rotations)) {
          if (degrees % 360 === 0) continue;
          const idx = parseInt(indexStr, 10);
          const mediaItem = post.media[idx];
          if (!mediaItem?.url || mediaItem.type === "video") continue;

          // Rotate locally with expo-image-manipulator
          const rotated = await ImageManipulator.manipulateAsync(
            mediaItem.url,
            [{ rotate: degrees }],
            { compress: 0.9, format: ImageManipulator.SaveFormat.JPEG },
          );

          // Upload rotated image via server upload
          const uploadResult = await uploadToServer(rotated.uri, "posts");
          if (uploadResult.success && uploadResult.url) {
            mediaUpdates.push({ order: idx, url: uploadResult.url });
          } else {
            showToast(
              "error",
              "Upload Failed",
              `Failed to upload rotated image ${idx + 1}`,
            );
            setIsRotating(false);
            return;
          }
        }

        if (mediaUpdates.length > 0) {
          updates.media = mediaUpdates;
        }
      } catch (err) {
        console.error("[EditPost] Rotation processing error:", err);
        showToast("error", "Error", "Failed to process rotated images");
        setIsRotating(false);
        return;
      }
      setIsRotating(false);
    }

    updateMutation.mutate(updates);

    // Navigate back immediately (optimistic)
    router.back();
  }, [
    id,
    isDirty,
    captionOverLimit,
    caption,
    location,
    isNSFW,
    originalIsNSFW,
    updateMutation,
    router,
    hasRotations,
    rotations,
    post?.media,
    isRotating,
    showToast,
  ]);

  // ─── Cancel with unsaved changes warning ───
  const handleCancel = useCallback(() => {
    if (isDirty) {
      Alert.alert(
        "Discard Changes?",
        "You have unsaved changes that will be lost.",
        [
          { text: "Keep Editing", style: "cancel" },
          {
            text: "Discard",
            style: "destructive",
            onPress: () => router.back(),
          },
        ],
      );
    } else {
      router.back();
    }
  }, [isDirty, router]);

  // ─── Image rotation handler ───
  const handleRotate = useCallback((index: number) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setRotations((prev) => ({
      ...prev,
      [index]: ((prev[index] || 0) + 90) % 360,
    }));
  }, []);

  // ─── Media carousel scroll handler ───
  const handleMediaScroll = useCallback(
    (event: any) => {
      const offsetX = event.nativeEvent.contentOffset.x;
      const index = Math.round(offsetX / SCREEN_WIDTH);
      if (index !== mediaIndex) setMediaIndex(index);
    },
    [mediaIndex],
  );

  // ═══════════════════════════════════════════
  // LOADING STATE
  // ═══════════════════════════════════════════
  if (isLoading) {
    return (
      <SafeAreaView edges={["top"]} className="flex-1 bg-background">
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color="#8A40CF" />
          <Text className="text-muted-foreground text-sm mt-3">
            Loading post...
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  // ═══════════════════════════════════════════
  // ERROR / NOT FOUND
  // ═══════════════════════════════════════════
  if (isError || !post) {
    return (
      <SafeAreaView edges={["top"]} className="flex-1 bg-background">
        <View className="flex-row items-center border-b border-border px-4 py-3">
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <ArrowLeft size={24} color="#fff" />
          </Pressable>
          <Text className="ml-4 text-lg font-semibold text-foreground">
            Edit Post
          </Text>
        </View>
        <View className="flex-1 items-center justify-center px-6">
          <Motion.View
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ type: "spring", damping: 20, stiffness: 300 }}
            className="items-center"
          >
            <View className="w-16 h-16 rounded-full bg-destructive/10 items-center justify-center mb-4">
              <AlertCircle size={32} color="#ef4444" />
            </View>
            <Text className="text-foreground text-lg font-semibold mb-2">
              Post Not Found
            </Text>
            <Text className="text-muted-foreground text-center text-sm">
              This post may have been deleted or is unavailable.
            </Text>
            <Pressable
              onPress={() => router.back()}
              className="mt-6 px-6 py-3 rounded-full bg-card"
            >
              <Text className="text-foreground font-medium">Go Back</Text>
            </Pressable>
          </Motion.View>
        </View>
      </SafeAreaView>
    );
  }

  // ═══════════════════════════════════════════
  // AUTHORIZATION GUARD — NOT OWNER
  // ═══════════════════════════════════════════
  if (!isOwner) {
    return (
      <SafeAreaView edges={["top"]} className="flex-1 bg-background">
        <View className="flex-row items-center border-b border-border px-4 py-3">
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <ArrowLeft size={24} color="#fff" />
          </Pressable>
          <Text className="ml-4 text-lg font-semibold text-foreground">
            Edit Post
          </Text>
        </View>
        <View className="flex-1 items-center justify-center px-6">
          <Motion.View
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ type: "spring", damping: 20, stiffness: 300 }}
            className="items-center"
          >
            <View className="w-16 h-16 rounded-full bg-destructive/10 items-center justify-center mb-4">
              <AlertCircle size={32} color="#ef4444" />
            </View>
            <Text className="text-foreground text-lg font-semibold mb-2">
              Not Authorized
            </Text>
            <Text className="text-muted-foreground text-center text-sm">
              You can only edit your own posts.
            </Text>
            <Pressable
              onPress={() => router.back()}
              className="mt-6 px-6 py-3 rounded-full bg-card"
            >
              <Text className="text-foreground font-medium">Go Back</Text>
            </Pressable>
          </Motion.View>
        </View>
      </SafeAreaView>
    );
  }

  // ═══════════════════════════════════════════
  // MAIN EDIT FORM
  // ═══════════════════════════════════════════
  const mediaItems = post.media || [];
  const hasMedia = mediaItems.length > 0;
  const hasMultipleMedia = mediaItems.length > 1;

  return (
    <SafeAreaView edges={["top"]} className="flex-1 bg-background">
      {/* ─── Header Bar ─── */}
      <Motion.View
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: "spring", damping: 25, stiffness: 300 }}
        className="flex-row items-center justify-between border-b border-border px-4 py-3"
      >
        <Pressable
          onPress={handleCancel}
          hitSlop={12}
          className="w-10 h-10 items-center justify-center rounded-full"
        >
          <ArrowLeft size={24} color="#fff" />
        </Pressable>

        <Text className="text-lg font-bold text-foreground">Edit Post</Text>

        <Pressable
          onPress={handleSave}
          disabled={
            !isDirty ||
            captionOverLimit ||
            updateMutation.isPending ||
            isRotating
          }
          hitSlop={12}
          className={`px-5 py-2 rounded-full ${
            isDirty && !captionOverLimit ? "bg-primary" : "bg-white/10"
          }`}
          style={{
            opacity:
              isDirty &&
              !captionOverLimit &&
              !updateMutation.isPending &&
              !isRotating
                ? 1
                : 0.4,
          }}
        >
          {updateMutation.isPending || isRotating ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text
              className={`font-semibold text-sm ${
                isDirty && !captionOverLimit
                  ? "text-white"
                  : "text-muted-foreground"
              }`}
            >
              Save
            </Text>
          )}
        </Pressable>
      </Motion.View>

      <KeyboardAwareScrollView
        bottomOffset={insets.bottom + 20}
        showsVerticalScrollIndicator={false}
        keyboardDismissMode="on-drag"
      >
        {/* ─── Media Preview Section ─── */}
        {hasMedia && (
          <Motion.View
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ type: "timing", duration: 400 }}
          >
            <RNScrollView
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              onMomentumScrollEnd={handleMediaScroll}
              decelerationRate="fast"
            >
              {mediaItems.map((media, index) => (
                <View
                  key={`media-${index}`}
                  style={{ width: SCREEN_WIDTH, height: MEDIA_HEIGHT }}
                  className="bg-black"
                >
                  {media.type === "video" ? (
                    <View className="flex-1 items-center justify-center">
                      <Image
                        source={{ uri: media.thumbnail || media.url }}
                        style={{ width: "100%", height: "100%" }}
                        contentFit="cover"
                      />
                      <View className="absolute inset-0 items-center justify-center bg-black/30">
                        <View className="w-12 h-12 rounded-full bg-white/20 items-center justify-center">
                          <Play size={24} color="#fff" fill="#fff" />
                        </View>
                      </View>
                    </View>
                  ) : (
                    <ImageTagger
                      postId={id!}
                      mediaUrl={media.url}
                      mediaIndex={index}
                      height={MEDIA_HEIGHT}
                      existingTags={postTags}
                      onTagsChanged={handleTagsChanged}
                      onRotate={() => handleRotate(index)}
                      rotationDegrees={rotations[index] || 0}
                    />
                  )}
                </View>
              ))}
            </RNScrollView>

            {/* Carousel dots */}
            {hasMultipleMedia && (
              <View className="flex-row items-center justify-center gap-1.5 py-3">
                {mediaItems.map((_, index) => (
                  <View
                    key={`dot-${index}`}
                    className={`rounded-full ${
                      index === mediaIndex
                        ? "w-2 h-2 bg-primary"
                        : "w-1.5 h-1.5 bg-white/30"
                    }`}
                  />
                ))}
              </View>
            )}

            {/* Media info bar */}
            <View className="flex-row items-center justify-between px-4 py-2 border-b border-white/5">
              <View className="flex-row items-center gap-2">
                <ImageIcon size={14} color="rgba(255,255,255,0.4)" />
                <Text className="text-muted-foreground text-xs">
                  {mediaItems.length}{" "}
                  {mediaItems.length === 1 ? "item" : "items"}
                </Text>
              </View>
              <Text className="text-muted-foreground text-[11px]">
                {hasRotations
                  ? "Rotated images will be re-uploaded on save"
                  : "Tap rotate to adjust images"}
              </Text>
            </View>
          </Motion.View>
        )}

        {/* ─── Caption Editor ─── */}
        <Motion.View
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{
            type: "spring",
            damping: 25,
            stiffness: 300,
            delay: 100,
          }}
          className="px-4 pt-5 pb-3"
        >
          <Text className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">
            CAPTION
          </Text>
          <UserMentionAutocomplete
            value={caption}
            onChangeText={setCaption}
            placeholder="Write a caption... (use @ to tag people)"
            multiline
            maxLength={MAX_CAPTION + 100}
            style={{ minHeight: 120, fontSize: 15, lineHeight: 22 }}
          />
          {captionOverLimit && (
            <Text className="text-xs text-red-400 font-semibold mt-1">
              Caption exceeds {MAX_CAPTION.toLocaleString()} characters
            </Text>
          )}
          <View className="flex-row items-center justify-between mt-1.5">
            <Text
              className={`text-xs ${
                captionOverLimit
                  ? "text-red-400 font-semibold"
                  : "text-muted-foreground"
              }`}
            >
              {caption.length.toLocaleString()}/{MAX_CAPTION.toLocaleString()}
            </Text>
            {caption.includes("#") && (
              <Text className="text-xs text-primary/60">
                {(caption.match(/#\w+/g) || []).length} hashtags
              </Text>
            )}
          </View>

          {/* Extracted hashtags preview */}
          {caption.includes("#") && (
            <Motion.View
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ type: "timing", duration: 250 }}
              className="flex-row flex-wrap gap-1.5 mt-3"
            >
              {(caption.match(/#\w+/g) || []).slice(0, 10).map((tag, index) => (
                <View
                  key={`${tag}-${index}`}
                  className="bg-primary/10 px-2.5 py-1 rounded-full"
                >
                  <Text className="text-primary text-xs font-medium">
                    {tag}
                  </Text>
                </View>
              ))}
              {(caption.match(/#\w+/g) || []).length > 10 && (
                <View className="bg-white/5 px-2.5 py-1 rounded-full">
                  <Text className="text-muted-foreground text-xs">
                    +{(caption.match(/#\w+/g) || []).length - 10} more
                  </Text>
                </View>
              )}
            </Motion.View>
          )}
        </Motion.View>

        {/* ─── Location Editor ─── */}
        <Motion.View
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{
            type: "spring",
            damping: 25,
            stiffness: 300,
            delay: 200,
          }}
          className="px-4 pb-3"
        >
          <LocationAutocompleteInstagram
            value={location?.name || ""}
            placeholder="Add a location..."
            onLocationSelect={(data: LocationData) => setLocation(data)}
            onClear={() => setLocation(null)}
            onTextChange={(text) => {
              // Clear location data if text is cleared
              if (!text) {
                setLocation(null);
              }
            }}
          />
        </Motion.View>

        {/* ─── Spicy Toggle ─── */}
        <Motion.View
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{
            type: "spring",
            damping: 25,
            stiffness: 300,
            delay: 250,
          }}
          className="px-4 pb-3"
        >
          <Text className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
            CONTENT RATING
          </Text>
          <Pressable
            onPress={() => setIsNSFW(!isNSFW)}
            className="flex-row items-center justify-between p-4 rounded-2xl bg-white/[0.03] border border-white/[0.06]"
          >
            <View className="flex-row items-center gap-3 flex-1">
              <View
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 10,
                  backgroundColor: isNSFW
                    ? "rgba(239, 68, 68, 0.15)"
                    : "rgba(255,255,255,0.05)",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Flame
                  size={18}
                  color={isNSFW ? "#ef4444" : "rgba(255,255,255,0.4)"}
                />
              </View>
              <View className="flex-1">
                <Text className="text-foreground text-sm font-semibold">
                  Spicy Content
                </Text>
                <Text className="text-muted-foreground text-xs mt-0.5">
                  Mark as 18+ / sensitive content
                </Text>
              </View>
            </View>
            <Switch
              value={isNSFW}
              onValueChange={setIsNSFW}
              trackColor={{ false: "#333", true: "rgba(239, 68, 68, 0.5)" }}
              thumbColor={isNSFW ? "#ef4444" : "#666"}
            />
          </Pressable>
        </Motion.View>

        {/* ─── Info Banner ─── */}
        <Motion.View
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{
            type: "spring",
            damping: 25,
            stiffness: 300,
            delay: 300,
          }}
          className="mx-4 mt-3 mb-6 p-4 rounded-2xl bg-white/[0.03] border border-white/[0.06] flex-row gap-3"
        >
          <AlertCircle size={18} color="rgba(255,255,255,0.25)" />
          <Text className="flex-1 text-xs text-muted-foreground leading-[18px]">
            Changes will be visible immediately to all followers. Media files
            cannot be modified after posting.
          </Text>
        </Motion.View>

        {/* Bottom spacer */}
        <View style={{ height: insets.bottom + 60 }} />
      </KeyboardAwareScrollView>
    </SafeAreaView>
  );
}

// Wrap with ErrorBoundary for crash protection
export default function EditPostScreen() {
  const router = useRouter();

  return (
    <ErrorBoundary screenName="EditPost" onGoBack={() => router.back()}>
      <EditPostScreenContent />
    </ErrorBoundary>
  );
}
