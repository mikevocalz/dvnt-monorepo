import {
  View,
  Text,
  ScrollView,
  Pressable,
  ActivityIndicator,
  useWindowDimensions,
  Linking,
  Modal,
} from "react-native";
import { Avatar } from "@dvnt/app/components/ui/avatar";
import { Image } from "expo-image";
import { DVNTAnimatedVideoView } from "@dvnt/app/components/media/DVNTAnimatedVideoView";
import {
  Settings,
  Album,
  Film,
  Bookmark,
  Tag,
  Camera,
  CalendarDays,
  Heart,
  X,
  LayoutDashboard,
  ChevronRight,
} from "lucide-react-native";
import { useRouter, useNavigation, Link } from "expo-router";
import { useColorScheme } from "@dvnt/app/lib/hooks";
import { useMemo, useEffect, useState, useCallback, useRef } from "react";
import { useBookmarkStore } from "@dvnt/app/lib/stores/bookmark-store";
import { useProfileStore } from "@dvnt/app/lib/stores/profile-store";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import { ProfileCompletionCard } from "@dvnt/app/components/profile-completion-card.native";
import { useUIStore } from "@dvnt/app/lib/stores/ui-store";
import { useAppStore } from "@dvnt/app/lib/stores/app-store";
import { ProfileSkeleton } from "@dvnt/app/components/skeletons";
import { Motion } from "@legendapp/motion";
import { useProfilePosts } from "@dvnt/app/lib/hooks/use-posts";
import { useMyProfile } from "@dvnt/app/lib/hooks/use-profile";
import { useBookmarks, useBookmarkedPosts } from "@dvnt/app/lib/hooks/use-bookmarks";
import { useMyEvents, useLikedEvents } from "@dvnt/app/lib/hooks/use-events";
import { useTaggedPosts } from "@dvnt/app/lib/hooks/use-post-tags";
import { useScreenTrace } from "@dvnt/app/lib/perf/screen-trace";
import { useBootstrapProfile } from "@dvnt/app/lib/hooks/use-bootstrap-profile";
// notificationKeys removed — app resume refresh handled by useAppResume globally
import * as ImagePicker from "expo-image-picker";
import { useMediaUpload } from "@dvnt/app/lib/hooks/use-media-upload";
import { usersApi } from "@dvnt/app/lib/api/users";
import { Badge } from "@dvnt/app/components/ui/badge";
import { useQueryClient } from "@tanstack/react-query";
import { ErrorBoundary } from "@dvnt/app/components/error-boundary";
import { ProfileMasonryGrid } from "@dvnt/app/components/profile/ProfileMasonryGrid";
import { normalizeArray } from "@dvnt/app/lib/normalization/safe-entity";
import {
  safeProfile,
  safeGridTiles,
  safeBookmarkIds,
  formatCountSafe,
  type SafeProfileData,
  type SafeGridTile,
} from "@dvnt/app/lib/utils/safe-profile-mappers";
import { appendCacheBuster, getAvatarUrl } from "@dvnt/app/lib/media/resolveAvatarUrl";
import { ProfileScreenGuard } from "@dvnt/app/components/profile/ProfileScreenGuard";
import { ProfilePronounsPill } from "@dvnt/app/components/profile/ProfilePronounsPill";

// mapPostToGridTile is now replaced by safeGridTiles from safe-profile-mappers.ts

function safeText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeProfileLinks(value: unknown): string[] {
  const sanitize = (items: unknown[]) =>
    items
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean);

  if (Array.isArray(value)) {
    return sanitize(value);
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return [];

    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return sanitize(parsed);
      }
    } catch {
      return [trimmed];
    }
  }

  return [];
}

function ProfileScreenContent() {
  const router = useRouter();
  const navigation = useNavigation();
  const { colors } = useColorScheme();
  const queryClient = useQueryClient();
  const showToast = useUIStore((s) => s.showToast);
  const trace = useScreenTrace("Profile");
  useBootstrapProfile();

  // Responsive grid: 2 columns on phone, 3 on tablet (768px+), 4 on large (1024px+)
  const { width: screenWidth } = useWindowDimensions();
  const numColumns = screenWidth >= 1024 ? 4 : screenWidth >= 768 ? 3 : 2;
  const columnWidth = (screenWidth - 2 * (numColumns + 1)) / numColumns;

  // DEFENSIVE: Get stores safely
  const { activeTab, setActiveTab } = useProfileStore();
  const bookmarkStore = useBookmarkStore();

  // Avatar update state
  const [isUpdatingAvatar, setIsUpdatingAvatar] = useState(false);
  const [avatarError, setAvatarError] = useState(false);
  const [isAvatarViewerOpen, setIsAvatarViewerOpen] = useState(false);
  const user = useAuthStore((state) => state.user);
  const setUser = useAuthStore((state) => state.setUser);
  const nsfwEnabled = useAppStore((state) => state.nsfwEnabled);

  // CRITICAL: userId must exist before any queries run
  // This is the KEY guard that prevents crashes
  const userId = user?.id ? String(user.id) : "";
  const hasUser = Boolean(userId);

  // Eager prefetch followers/following — data in cache before user taps
  useEffect(() => {
    if (!userId) return;
    queryClient.prefetchInfiniteQuery({
      queryKey: ["users", "followers", userId],
      queryFn: async () => {
        const result = await usersApi.getFollowers(userId, 1);
        return {
          users: result.docs || [],
          nextPage: result.hasNextPage ? 2 : null,
        };
      },
      initialPageParam: 1,
    });
    queryClient.prefetchInfiniteQuery({
      queryKey: ["users", "following", userId],
      queryFn: async () => {
        const result = await usersApi.getFollowing(userId, 1);
        return {
          users: result.docs || [],
          nextPage: result.hasNextPage ? 2 : null,
        };
      },
      initialPageParam: 1,
    });
  }, [userId, queryClient]);

  // CRITICAL: Fetch profile data with counts from backend
  // ONLY enabled when we have a valid userId
  const {
    data: profileData,
    isLoading: isLoadingProfile,
    isError: isProfileError,
    error: profileError,
    refetch: refetchProfile,
  } = useMyProfile();
  const { uploadSingle } = useMediaUpload({
    folder: "avatars",
    userId: user?.id,
  });

  // Direct avatar update - opens photo picker and updates immediately
  const handleAvatarPress = useCallback(async () => {
    if (isUpdatingAvatar) return;

    try {
      const { status } =
        await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== "granted") {
        showToast(
          "error",
          "Permission Required",
          "Please grant media library access to change your photo.",
        );
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
      });

      if (result.canceled || !result.assets[0]) return;

      setIsUpdatingAvatar(true);
      const selectedUri = result.assets[0].uri;

      // OPTIMISTIC: Show local image immediately before upload
      const previousAvatar = user?.avatar;
      if (user) {
        setUser({ ...user, avatar: selectedUri });
      }

      // Upload to Bunny CDN
      const uploadResult = await uploadSingle(selectedUri);
      if (!uploadResult.success || !uploadResult.url) {
        // ROLLBACK: Restore previous avatar on failure
        if (user) {
          setUser({ ...user, avatar: previousAvatar });
        }
        showToast(
          "error",
          "Upload Failed",
          "Failed to upload image. Please try again.",
        );
        setIsUpdatingAvatar(false);
        return;
      }

      // Update profile with new avatar on backend
      try {
        await usersApi.updateAvatar(uploadResult.url);
      } catch {
        // Backend update failed — rollback
        if (user) {
          setUser({ ...user, avatar: previousAvatar });
        }
        showToast("error", "Error", "Couldn't save changes. Try again.");
        setIsUpdatingAvatar(false);
        return;
      }

      // CRITICAL: Append cache-buster so expo-image re-downloads instead of
      // serving the stale cached version of the previous avatar at the same CDN path.
      const newAvatarUrl =
        appendCacheBuster(uploadResult.url) || uploadResult.url;

      // Update local auth store
      if (user) {
        setUser({ ...user, avatar: newAvatarUrl });
      }

      // CRITICAL: Patch all caches where MY avatar appears
      // This ensures instant UI sync across the entire app
      // Do NOT invalidate profile queries — that refetches from DB and overwrites
      // the optimistic value before the edge function write is visible.
      const userId = user?.id;
      const username = user?.username;

      // 1. Directly patch profile cache with new avatar (no refetch)
      if (userId) {
        queryClient.setQueryData(["profile", userId], (old: any) => {
          if (!old) return old;
          return { ...old, avatar: newAvatarUrl, avatarUrl: newAvatarUrl };
        });
      }
      if (username) {
        queryClient.setQueryData(
          ["profile", "username", username],
          (old: any) => {
            if (!old) return old;
            return { ...old, avatar: newAvatarUrl, avatarUrl: newAvatarUrl };
          },
        );
        // Also patch useUser cache (used by [username].tsx profile screen)
        queryClient.setQueryData(
          ["users", "username", username],
          (old: any) => {
            if (!old) return old;
            return { ...old, avatar: newAvatarUrl };
          },
        );
      }

      // 2. Patch feed cache - update my posts' author avatar
      queryClient.setQueryData(["posts", "feed"], (old: any) => {
        if (!old || !Array.isArray(old)) return old;
        return old.map((post: any) => {
          if (
            String(post.author?.id) === String(userId) ||
            post.author?.username === username
          ) {
            return {
              ...post,
              author: { ...post.author, avatar: newAvatarUrl },
            };
          }
          return post;
        });
      });

      // 3. Patch infinite feed cache
      queryClient.setQueryData(["posts", "feed", "infinite"], (old: any) => {
        if (!old?.pages) return old;
        return {
          ...old,
          pages: old.pages.map((page: any) => ({
            ...page,
            data: page.data?.map((post: any) => {
              if (
                String(post.author?.id) === String(userId) ||
                post.author?.username === username
              ) {
                return {
                  ...post,
                  author: { ...post.author, avatar: newAvatarUrl },
                };
              }
              return post;
            }),
          })),
        };
      });

      // 4. Patch profile posts cache
      if (userId) {
        queryClient.setQueryData(["profilePosts", userId], (old: any) => {
          if (!old || !Array.isArray(old)) return old;
          return old.map((post: any) => ({
            ...post,
            author: { ...post.author, avatar: newAvatarUrl },
          }));
        });
      }

      // 5. Patch stories cache - update MY stories' avatar
      // CRITICAL: useStories uses key ["stories", "list"], patch both
      const patchStories = (old: any) => {
        if (!old || !Array.isArray(old)) return old;
        return old.map((story: any) => {
          if (
            String(story.userId) === String(userId) ||
            story.username === username
          ) {
            return { ...story, avatar: newAvatarUrl };
          }
          return story;
        });
      };
      queryClient.setQueryData(["stories"], patchStories);
      queryClient.setQueryData(["stories", "list"], patchStories);

      console.log(
        "[Profile] Avatar synced to auth store, feed, profile posts, and stories",
      );
      showToast("success", "Updated", "Profile photo updated!");
    } catch (error: any) {
      console.error("[Profile] Avatar update error:", error);
      showToast("error", "Error", error?.message || "Failed to update photo");
    } finally {
      setIsUpdatingAvatar(false);
    }
  }, [isUpdatingAvatar, uploadSingle, user, setUser, queryClient, showToast]);

  // PHASE 0: Compute display values from profileData (API) with user (auth store) fallback
  // CRITICAL: profileData is the canonical source, user is fallback only
  const displayName =
    profileData?.displayName || profileData?.name || user?.name || "User";
  // CRITICAL: Use canonical resolver — never fall back to empty string.
  // getAvatarUrl handles string/object/null and returns null (not "") when missing.
  const displayAvatar = getAvatarUrl(profileData) || getAvatarUrl(user) || null;
  // CRITICAL: Compute a guaranteed valid avatar URL — never pass empty string to Image
  // Also allow file:// URIs from optimistic local picks
  const avatarUri =
    displayAvatar &&
    (displayAvatar.startsWith("http") || displayAvatar.startsWith("file://"))
      ? displayAvatar
      : null;

  // Reset error state when avatar URL changes (new upload or profile refetch)
  useEffect(() => {
    setAvatarError(false);
  }, [avatarUri]);
  const displayUsername = profileData?.username || user?.username || "";
  const displayBio = safeText(profileData?.bio) || safeText(user?.bio);
  const displayPronouns =
    safeText((profileData as any)?.pronouns) ||
    safeText((user as any)?.pronouns);
  const displayLocation =
    safeText(profileData?.location) || safeText(user?.location);
  const displayWebsite =
    safeText(profileData?.website) || safeText(user?.website);
  const displayLinks = normalizeProfileLinks(
    (profileData as any)?.links ?? (user as any)?.links,
  );
  const displayHashtags = user?.hashtags; // Only in auth store
  const displayFollowersCount =
    profileData?.followersCount ?? user?.followersCount ?? 0;
  const displayFollowingCount =
    profileData?.followingCount ?? user?.followingCount ?? 0;
  const displayPostsCount = profileData?.postsCount ?? user?.postsCount ?? 0;

  // PHASE 0 INSTRUMENTATION: Log profile data sources
  if (__DEV__) {
    console.log("[Profile] Data sources:", {
      userId: user?.id,
      profileDataExists: !!profileData,
      displayAvatar: displayAvatar?.slice(0, 50),
      displayName,
      displayUsername,
      counts: {
        followers: displayFollowersCount,
        following: displayFollowingCount,
        posts: displayPostsCount,
      },
      isLoadingProfile,
    });
  }

  // DEFENSIVE: Wrap useBookmarks in try-catch pattern via safe defaults
  const bookmarksQuery = useBookmarks();
  const bookmarkedPostIds = bookmarksQuery.data ?? [];
  const bookmarksError = bookmarksQuery.isError;
  const bookmarksQueryError = bookmarksQuery.error;

  // Log bookmarks query state
  console.log("[Profile] Bookmarks:", {
    count: Array.isArray(bookmarkedPostIds) ? bookmarkedPostIds.length : 0,
    isError: bookmarksError,
    error: bookmarksQueryError?.message,
  });
  // Sync API bookmarks to local store - use API bookmarks as source of truth
  // Defensive: ensure bookmarkedPostIds is always an array
  const safeBookmarkedPostIds = Array.isArray(bookmarkedPostIds)
    ? bookmarkedPostIds
    : [];

  // DEFENSIVE: Safely get bookmarks from store with fallback
  const storeBookmarks = safeBookmarkIds(
    null,
    () => bookmarkStore.getBookmarkedPostIds() || [],
  );

  const bookmarkedPosts =
    safeBookmarkedPostIds.length > 0 ? safeBookmarkedPostIds : storeBookmarks;
  // Narrow selectors — destructuring the whole store subscribed the
  // profile screen to every loading flag in the app; the profile would
  // re-render on unrelated screen loads (events, search, …).
  const isLoading = useUIStore((s) => s.loadingScreens.profile);
  const setScreenLoading = useUIStore((s) => s.setScreenLoading);

  // PHASE 1 INSTRUMENTATION: Log user state
  console.log("[Profile] User:", {
    id: user?.id,
    username: user?.username,
    hasUser: !!user,
  });

  // Logged-in user ID - safe even if user is null
  const loggedInUserId = String(user?.id || "");
  console.log("[Profile] loggedInUserId:", loggedInUserId);

  // Track previous user ID to detect user switches
  const prevUserIdRef = useRef<string | null>(null);

  // Header is now managed by the custom TabsHeader component in _layout.tsx
  // which reads the current pathname to determine what to render.

  // Fetch real user posts - ONLY for logged-in user
  // Must be called unconditionally (React hooks rule) - BEFORE any early returns
  const {
    data: userPostsData,
    isLoading: isLoadingPosts,
    isError: postsError,
    error: postsQueryError,
    refetch,
  } = useProfilePosts(loggedInUserId);

  // Don't render if no user
  if (!user) {
    return (
      <View className="flex-1 bg-background items-center justify-center">
        <Text className="text-muted-foreground">Loading profile...</Text>
      </View>
    );
  }

  // PHASE 1 INSTRUMENTATION: Log posts query state with date range
  if (__DEV__) {
    const postDates =
      userPostsData
        ?.map((p) => p.createdAt)
        .filter(Boolean)
        .sort() || [];
    console.log("[Profile] Posts:", {
      count: userPostsData?.length || 0,
      isLoading: isLoadingPosts,
      isError: postsError,
      error: postsQueryError?.message,
      oldestCreatedAt: postDates[0] || null,
      newestCreatedAt: postDates[postDates.length - 1] || null,
    });
  }

  // CRITICAL: When user ID changes (user switched), force refetch and clear stale data
  useEffect(() => {
    if (
      prevUserIdRef.current !== null &&
      prevUserIdRef.current !== loggedInUserId
    ) {
      console.log(
        "[Profile] User switched from",
        prevUserIdRef.current,
        "to",
        loggedInUserId,
      );
      // Force refetch for the new user
      refetch();
    }

    prevUserIdRef.current = loggedInUserId;
  }, [loggedInUserId, refetch]);

  // Clear loading gate immediately — cache-first means data is already available
  useEffect(() => {
    setScreenLoading("profile", false);
  }, [setScreenLoading]);

  // NOTE: App resume refresh is handled globally by useAppResume hook
  // in (protected)/_layout.tsx — no duplicate AppState listener needed here

  // Transform user posts data using SAFE mapper - NEVER throws
  const visibleUserPosts = useMemo(
    () =>
      nsfwEnabled
        ? userPostsData
        : (userPostsData || []).filter((post) => !post.isNSFW),
    [userPostsData, nsfwEnabled],
  );

  const userPosts: SafeGridTile[] = useMemo(() => {
    return safeGridTiles(visibleUserPosts);
  }, [visibleUserPosts]);

  // Fetch bookmarked posts in ONE round trip via the get-bookmarks edge
  // function with { withPosts: true } — replaces the old
  // `useBookmarks() + usePostsByIds()` waterfall (IDs then N parallel
  // post fetches). `useBookmarks()` above still runs for the is-this-
  // bookmarked boolean used across other screens / the zustand sync.
  const { data: bookmarkedPostsData = [] } = useBookmarkedPosts();

  // Transform saved posts using SAFE mapper - NEVER throws
  const savedPosts: SafeGridTile[] = useMemo(() => {
    return safeGridTiles(bookmarkedPostsData);
  }, [bookmarkedPostsData]);

  // Filter video posts - safe with typed array
  const videoPosts: SafeGridTile[] = useMemo(() => {
    return userPosts.filter((p) => p.kind === "video");
  }, [userPosts]);

  // Tagged posts — real data from post_tags API
  const { data: taggedPostsRaw = [] } = useTaggedPosts(loggedInUserId);
  const taggedPosts: SafeGridTile[] = useMemo(() => {
    return safeGridTiles(taggedPostsRaw);
  }, [taggedPostsRaw]);

  // Fetch user's events (hosting + RSVP'd)
  const { data: myEventsRaw } = useMyEvents();
  const myEvents = useMemo(() => normalizeArray(myEventsRaw), [myEventsRaw]);

  // Fetch user's liked/saved events
  const { data: likedEventsRaw } = useLikedEvents();
  const likedEvents = useMemo(
    () => normalizeArray(likedEventsRaw),
    [likedEventsRaw],
  );

  // Select display posts based on active tab - fully typed
  const displayPosts: SafeGridTile[] = useMemo(() => {
    switch (activeTab) {
      case "posts":
        return userPosts;
      case "video":
        return videoPosts;
      case "saved":
        return savedPosts;
      case "tagged":
        return taggedPosts;
      default:
        return userPosts;
    }
  }, [activeTab, savedPosts, videoPosts, userPosts]);

  // CRITICAL: Early return if no user - MUST come AFTER all hooks
  // This ensures hooks are called in same order every render (React rules)
  if (!user) {
    return (
      <View className="flex-1 bg-background items-center justify-center">
        <Text className="text-muted-foreground">Loading profile...</Text>
      </View>
    );
  }

  // Skeleton ONLY when truly no data (first ever boot, no cache)
  // With MMKV persistence, cache-hit means zero skeleton on cold start
  if ((isLoading || isLoadingPosts) && !profileData && !userPostsData) {
    return (
      <View className="flex-1 bg-background">
        <ProfileSkeleton />
      </View>
    );
  }

  return (
    <View
      className="flex-1 bg-background max-w-3xl w-full self-center"
      testID="screen.profile"
    >
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerClassName="pb-5"
      >
        <View className="px-5 pt-5 pb-4">
          {/* Centered Profile Header */}
          <View className="items-center">
            <View className="flex-row items-center justify-center gap-8 mb-6">
              <View className="relative">
                {avatarUri && !avatarError ? (
                  <Pressable
                    onPress={() => setIsAvatarViewerOpen(true)}
                    hitSlop={10}
                  >
                    <View
                      style={{
                        width: 88,
                        height: 88,
                        borderRadius: 20,
                        overflow: "hidden",
                        borderWidth: 1.5,
                        borderColor: "#34A2DF",
                        backgroundColor: "#1a1a1a",
                      }}
                    >
                      <Image
                        source={{ uri: avatarUri }}
                        style={{
                          width: 88,
                          height: 88,
                          borderRadius: 20,
                          backgroundColor: "#1a1a1a",
                        }}
                        contentFit="cover"
                        cachePolicy="memory-disk"
                        onError={() => setAvatarError(true)}
                      />
                    </View>
                  </Pressable>
                ) : (
                  <Pressable
                    onPress={handleAvatarPress}
                    disabled={isUpdatingAvatar}
                  >
                    <View
                      style={{
                        width: 88,
                        height: 88,
                        borderRadius: 20,
                        backgroundColor: "rgb(62, 164, 229)",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <Text
                        style={{
                          color: "#fff",
                          fontSize: 32,
                          fontWeight: "800",
                        }}
                      >
                        {(displayName || displayUsername || "U")
                          .charAt(0)
                          .toUpperCase()}
                      </Text>
                    </View>
                  </Pressable>
                )}
                {isUpdatingAvatar ? (
                  <View className="absolute inset-0 items-center justify-center rounded-[20px] bg-black/50">
                    <ActivityIndicator size="small" color="#fff" />
                  </View>
                ) : (
                  <Pressable
                    onPress={handleAvatarPress}
                    hitSlop={12}
                    className="absolute -bottom-1 left-1/2 h-7 w-7 items-center justify-center rounded-[8px] bg-primary border-2"
                    style={{
                      borderColor: colors.background,
                      transform: [{ translateX: -14 }],
                    }}
                  >
                    <Camera size={14} color="#fff" />
                  </Pressable>
                )}
              </View>
              <View className="flex-row gap-8">
                <View
                  className="items-center"
                  testID={`profile.${user?.id}.postsCount`}
                >
                  <Text className="text-xl font-bold text-foreground">
                    {displayPostsCount}
                  </Text>
                  <Text className="text-xs text-muted-foreground">Posts</Text>
                </View>
                <Pressable
                  className="items-center"
                  testID={`profile.${user?.id}.followersCount`}
                  onPress={() => {
                    if (user?.id) {
                      queryClient.prefetchInfiniteQuery({
                        queryKey: ["users", "followers", user.id],
                        queryFn: async () => {
                          const result = await usersApi.getFollowers(
                            user.id,
                            1,
                          );
                          return {
                            users: result.docs || [],
                            nextPage: result.hasNextPage ? 2 : null,
                          };
                        },
                        initialPageParam: 1,
                      });
                      router.push(
                        `/(protected)/profile/followers?userId=${user.id}&username=${displayUsername}`,
                      );
                    }
                  }}
                >
                  <Text className="text-xl font-bold text-foreground">
                    {formatCountSafe(displayFollowersCount)}
                  </Text>
                  <Text className="text-xs text-muted-foreground">
                    Followers
                  </Text>
                </Pressable>
                <Pressable
                  className="items-center"
                  testID={`profile.${user?.id}.followingCount`}
                  onPress={() => {
                    if (user?.id) {
                      queryClient.prefetchInfiniteQuery({
                        queryKey: ["users", "following", user.id],
                        queryFn: async () => {
                          const result = await usersApi.getFollowing(
                            user.id,
                            1,
                          );
                          return {
                            users: result.docs || [],
                            nextPage: result.hasNextPage ? 2 : null,
                          };
                        },
                        initialPageParam: 1,
                      });
                      router.push(
                        `/(protected)/profile/following?userId=${user.id}&username=${displayUsername}`,
                      );
                    }
                  }}
                >
                  <Text className="text-xl font-bold text-foreground">
                    {formatCountSafe(displayFollowingCount)}
                  </Text>
                  <Text className="text-xs text-muted-foreground">
                    Following
                  </Text>
                </Pressable>
                <Pressable
                  className="items-center"
                  testID={`profile.${user?.id}.eventsCount`}
                  onPress={() => setActiveTab("events")}
                >
                  <Text className="text-xl font-bold text-foreground">
                    {formatCountSafe(myEvents.length + likedEvents.length)}
                  </Text>
                  <Text className="text-xs text-muted-foreground">Events</Text>
                </Pressable>
              </View>
            </View>
          </View>

          <View className="mt-4">
            <View className="flex-row flex-wrap items-center gap-2">
              <Text className="text-base font-semibold text-foreground">
                {displayName}
              </Text>
              <ProfilePronounsPill
                pronouns={displayPronouns}
                inline
              />
            </View>
            {displayBio && (
              <Text className="mt-1.5 text-sm leading-5 text-foreground/90">
                {displayBio}
              </Text>
            )}
            {displayLocation && (
              <Text className="mt-1.5 text-sm text-muted-foreground">
                {displayLocation}
              </Text>
            )}
            {displayWebsite && (
              <Pressable
                onPress={() => {
                  const url = displayWebsite.startsWith("http")
                    ? displayWebsite
                    : `https://${displayWebsite}`;
                  Linking.openURL(url);
                }}
              >
                <Text className="mt-1.5 text-sm font-medium text-primary">
                  {displayWebsite}
                </Text>
              </Pressable>
            )}
            {displayLinks.length > 0 &&
              displayLinks
                .filter((l) => l !== displayWebsite)
                .map((link, i) => (
                  <Pressable
                    key={i}
                    onPress={() => {
                      const url = link.startsWith("http")
                        ? link
                        : `https://${link}`;
                      Linking.openURL(url);
                    }}
                  >
                    <Text className="mt-1 text-sm font-medium text-primary">
                      {link}
                    </Text>
                  </Pressable>
                ))}
            {Array.isArray(displayHashtags) && displayHashtags.length > 0 && (
              <View className="mt-2 flex-row flex-wrap gap-2">
                {displayHashtags.map((tag, index) => (
                  <Badge key={tag + index} variant="secondary">
                    <Text className="text-xs font-medium text-secondary-foreground">
                      #{tag}
                    </Text>
                  </Badge>
                ))}
              </View>
            )}
          </View>

          <View className="mt-5 flex-row gap-2 px-4">
            <Link href="/(protected)/edit-profile" asChild>
              <Pressable className="flex-1 items-center justify-center py-2.5 rounded-[10px] bg-secondary px-4">
                <Text className="font-semibold text-secondary-foreground">
                  Edit profile
                </Text>
              </Pressable>
            </Link>
          </View>

          {/* B2: completion ring + checklist (weighted; jumps to edit). */}
          <ProfileCompletionCard />
        </View>

        {/* Tabs */}
        <View
          className="flex-row justify-around items-center my-4 mx-4 px-1 py-2 rounded-lg"
          style={{
            backgroundColor: "rgba(28, 28, 28, 0.6)",
            borderColor: "rgba(68, 68, 68, 0.8)",
            borderWidth: 1,
            minHeight: 44,
          }}
        >
          <Pressable
            onPress={() => setActiveTab("posts")}
            className="flex-row items-center justify-center gap-1 flex-1"
            style={{
              backgroundColor:
                activeTab === "posts" ? "rgba(255,255,255,0.10)" : undefined,
              paddingVertical: 6,
              borderRadius: 8,
            }}
          >
            <Album
              size={14}
              color={activeTab === "posts" ? "#f5f5f4" : "#737373"}
            />
            <Text
              style={{
                color: activeTab === "posts" ? "#f5f5f4" : "#a3a3a3",
                fontSize: 11,
                fontWeight: "600",
              }}
            >
              Posts
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setActiveTab("video")}
            className="flex-row items-center justify-center gap-1 flex-1"
            style={{
              backgroundColor:
                activeTab === "video" ? "rgba(255,255,255,0.10)" : undefined,
              paddingVertical: 6,
              borderRadius: 8,
            }}
          >
            <Film
              size={14}
              color={activeTab === "video" ? "#f5f5f4" : "#737373"}
            />
            <Text
              style={{
                color: activeTab === "video" ? "#f5f5f4" : "#a3a3a3",
                fontSize: 11,
                fontWeight: "600",
              }}
            >
              Video
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setActiveTab("events")}
            className="flex-row items-center justify-center gap-1 flex-1"
            style={{
              backgroundColor:
                activeTab === "events" ? "rgba(255,255,255,0.10)" : undefined,
              paddingVertical: 6,
              borderRadius: 8,
            }}
          >
            <CalendarDays
              size={14}
              color={activeTab === "events" ? "#f5f5f4" : "#737373"}
            />
            <Text
              style={{
                color: activeTab === "events" ? "#f5f5f4" : "#a3a3a3",
                fontSize: 11,
                fontWeight: "600",
              }}
            >
              Events
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setActiveTab("saved")}
            className="flex-row items-center justify-center gap-1 flex-1"
            style={{
              backgroundColor:
                activeTab === "saved" ? "rgba(255,255,255,0.10)" : undefined,
              paddingVertical: 6,
              borderRadius: 8,
            }}
          >
            <Bookmark
              size={14}
              color={activeTab === "saved" ? "#f5f5f4" : "#737373"}
            />
            <Text
              style={{
                color: activeTab === "saved" ? "#f5f5f4" : "#a3a3a3",
                fontSize: 11,
                fontWeight: "600",
              }}
            >
              Saved
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setActiveTab("tagged")}
            className="flex-row items-center justify-center gap-1 flex-1"
            style={{
              backgroundColor:
                activeTab === "tagged" ? "rgba(255,255,255,0.10)" : undefined,
              paddingVertical: 6,
              borderRadius: 8,
            }}
          >
            <Tag
              size={14}
              color={activeTab === "tagged" ? "#f5f5f4" : "#737373"}
            />
            <Text
              style={{
                color: activeTab === "tagged" ? "#f5f5f4" : "#a3a3a3",
                fontSize: 11,
                fontWeight: "600",
              }}
            >
              Tagged
            </Text>
          </Pressable>
        </View>

        {/* Content based on active tab */}
        <View
          style={{ minHeight: columnWidth * 2 }}
          testID={`profile.${user?.id}.grid`}
        >
          {activeTab === "events" ? (
            <View className="px-4 pt-2">
              {myEvents.length > 0 && (
                <Pressable
                  onPress={() =>
                    router.push("/(protected)/events/host" as any)
                  }
                  className="flex-row items-center gap-3 p-3 rounded-xl mb-4"
                  style={{
                    backgroundColor: "rgba(138,64,207,0.10)",
                    borderColor: "rgba(138,64,207,0.35)",
                    borderWidth: 1,
                  }}
                >
                  <View
                    style={{
                      width: 42,
                      height: 42,
                      borderRadius: 21,
                      backgroundColor: "rgba(138,64,207,0.18)",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <LayoutDashboard size={20} color="#C084FC" />
                  </View>
                  <View className="flex-1">
                    <Text
                      className="text-foreground font-semibold text-sm"
                      numberOfLines={1}
                    >
                      Host Dashboard
                    </Text>
                    <Text className="text-muted-foreground text-xs mt-0.5">
                      Tonight, upcoming, sales & scan rate
                    </Text>
                  </View>
                  <ChevronRight size={18} color="#a3a3a3" />
                </Pressable>
              )}

              {/* My Events Section */}
              {myEvents.length > 0 && (
                <View className="mb-4">
                  <Text
                    style={{
                      color: "#a3a3a3",
                      fontSize: 13,
                      fontWeight: "600",
                      marginBottom: 8,
                      textTransform: "uppercase",
                      letterSpacing: 0.5,
                    }}
                  >
                    My Events
                  </Text>
                  <View style={{ gap: 10 }}>
                    {myEvents.map((event: any, index: number) => (
                      <Motion.View
                        key={`myevent-${event.id}-${index}`}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{
                          type: "spring",
                          damping: 20,
                          stiffness: 100,
                          delay: index * 0.05,
                        }}
                      >
                        <Pressable
                          onPress={() =>
                            router.push(
                              `/(protected)/events/${event.id}` as any,
                            )
                          }
                          className="flex-row items-center gap-3 p-3 rounded-xl"
                          style={{
                            backgroundColor: "rgba(28, 28, 28, 0.6)",
                            borderColor: "rgba(62, 164, 229, 0.15)",
                            borderWidth: 1,
                          }}
                        >
                          {event.flyerVideoUrl ? (
                            <DVNTAnimatedVideoView
                              uri={event.flyerVideoUrl}
                              width={56}
                              height={56}
                              style={{
                                width: 56,
                                height: 56,
                                borderRadius: 10,
                                backgroundColor: "#1a1a1a",
                              }}
                              contentFit="cover"
                              muted
                            />
                          ) : event.image ? (
                            <Image
                              source={{ uri: event.image }}
                              style={{
                                width: 56,
                                height: 56,
                                borderRadius: 10,
                                backgroundColor: "#1a1a1a",
                              }}
                              contentFit="cover"
                            />
                          ) : (
                            <View
                              style={{
                                width: 56,
                                height: 56,
                                borderRadius: 10,
                                backgroundColor: "rgba(63,220,255,0.08)",
                                borderWidth: 1,
                                borderColor: "rgba(63,220,255,0.18)",
                                alignItems: "center",
                                justifyContent: "center",
                              }}
                            >
                              <CalendarDays
                                size={22}
                                color="rgba(63,220,255,0.65)"
                              />
                            </View>
                          )}
                          <View className="flex-1">
                            <Text
                              className="text-foreground font-semibold text-sm"
                              numberOfLines={1}
                            >
                              {event.title}
                            </Text>
                            {(event.fullDate || event.date) && (
                              <Text className="text-muted-foreground text-xs mt-0.5">
                                {new Date(
                                  event.fullDate || event.date,
                                ).toLocaleDateString("en-US", {
                                  month: "short",
                                  day: "numeric",
                                  year: "numeric",
                                })}
                              </Text>
                            )}
                            {event.location && (
                              <Text
                                className="text-muted-foreground text-xs mt-0.5"
                                numberOfLines={1}
                              >
                                {event.location}
                              </Text>
                            )}
                          </View>
                        </Pressable>
                      </Motion.View>
                    ))}
                  </View>
                </View>
              )}

              {/* Liked Events Section */}
              {likedEvents.length > 0 && (
                <View className="mb-4">
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 6,
                      marginBottom: 8,
                    }}
                  >
                    <Heart size={13} color="#FF5BFC" fill="#FF5BFC" />
                    <Text
                      style={{
                        color: "#a3a3a3",
                        fontSize: 13,
                        fontWeight: "600",
                        textTransform: "uppercase",
                        letterSpacing: 0.5,
                      }}
                    >
                      Liked Events
                    </Text>
                  </View>
                  <View style={{ gap: 10 }}>
                    {likedEvents.map((event: any, index: number) => (
                      <Motion.View
                        key={`liked-${event.id}-${index}`}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{
                          type: "spring",
                          damping: 20,
                          stiffness: 100,
                          delay: index * 0.05,
                        }}
                      >
                        <Pressable
                          onPress={() =>
                            router.push(
                              `/(protected)/events/${event.id}` as any,
                            )
                          }
                          className="flex-row items-center gap-3 p-3 rounded-xl"
                          style={{
                            backgroundColor: "rgba(28, 28, 28, 0.6)",
                            borderColor: "rgba(255, 91, 252, 0.15)",
                            borderWidth: 1,
                          }}
                        >
                          {event.flyerVideoUrl ? (
                            <DVNTAnimatedVideoView
                              uri={event.flyerVideoUrl}
                              width={56}
                              height={56}
                              style={{
                                width: 56,
                                height: 56,
                                borderRadius: 10,
                                backgroundColor: "#1a1a1a",
                              }}
                              contentFit="cover"
                              muted
                            />
                          ) : event.image ? (
                            <Image
                              source={{ uri: event.image }}
                              style={{
                                width: 56,
                                height: 56,
                                borderRadius: 10,
                                backgroundColor: "#1a1a1a",
                              }}
                              contentFit="cover"
                            />
                          ) : (
                            <View
                              style={{
                                width: 56,
                                height: 56,
                                borderRadius: 10,
                                backgroundColor: "#1a1a1a",
                                alignItems: "center",
                                justifyContent: "center",
                              }}
                            >
                              <Heart size={24} color="#FF5BFC" />
                            </View>
                          )}
                          <View className="flex-1">
                            <Text
                              className="text-foreground font-semibold text-sm"
                              numberOfLines={1}
                            >
                              {event.title}
                            </Text>
                            {(event.fullDate || event.date) && (
                              <Text className="text-muted-foreground text-xs mt-0.5">
                                {new Date(
                                  event.fullDate || event.date,
                                ).toLocaleDateString("en-US", {
                                  month: "short",
                                  day: "numeric",
                                  year: "numeric",
                                })}
                              </Text>
                            )}
                            {event.location && (
                              <Text
                                className="text-muted-foreground text-xs mt-0.5"
                                numberOfLines={1}
                              >
                                {event.location}
                              </Text>
                            )}
                          </View>
                          <Heart
                            size={16}
                            color="#FF5BFC"
                            fill="#FF5BFC"
                            style={{ marginRight: 4 }}
                          />
                        </Pressable>
                      </Motion.View>
                    ))}
                  </View>
                </View>
              )}

              {/* Empty state */}
              {myEvents.length === 0 && likedEvents.length === 0 && (
                <View className="items-center justify-center py-16">
                  <CalendarDays size={48} color={colors.mutedForeground} />
                  <Text className="mt-4 text-base text-muted-foreground">
                    No events yet
                  </Text>
                </View>
              )}
            </View>
          ) : (
            <ProfileMasonryGrid
              data={displayPosts}
              userId={user?.id}
              scrollEnabled={false}
              ListEmptyComponent={
                <View className="items-center justify-center py-16">
                  <Bookmark size={48} color={colors.mutedForeground} />
                  <Text className="mt-4 text-base text-muted-foreground">
                    {activeTab === "saved"
                      ? "No saved posts yet"
                      : activeTab === "tagged"
                        ? "No tagged posts yet"
                        : activeTab === "video"
                          ? "No videos yet"
                          : "No posts yet"}
                  </Text>
                </View>
              }
            />
          )}
        </View>
      </ScrollView>

      <Modal
        visible={isAvatarViewerOpen && !!avatarUri}
        transparent
        animationType="fade"
        onRequestClose={() => setIsAvatarViewerOpen(false)}
      >
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.96)" }}>
          <Pressable
            onPress={() => setIsAvatarViewerOpen(false)}
            style={{ position: "absolute", inset: 0 }}
          />
          <View
            style={{
              flex: 1,
              alignItems: "center",
              justifyContent: "center",
              paddingHorizontal: 20,
              paddingVertical: 40,
            }}
          >
            {avatarUri ? (
              <Image
                source={{ uri: avatarUri }}
                style={{ width: "100%", height: "100%" }}
                contentFit="contain"
                cachePolicy="memory-disk"
              />
            ) : null}
          </View>
          <Pressable
            onPress={() => setIsAvatarViewerOpen(false)}
            hitSlop={12}
            style={{
              position: "absolute",
              top: 52,
              right: 20,
              width: 40,
              height: 40,
              borderRadius: 20,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: "rgba(255,255,255,0.12)",
              borderWidth: 1,
              borderColor: "rgba(255,255,255,0.18)",
            }}
          >
            <X size={20} color="#fff" />
          </Pressable>
        </View>
      </Modal>
    </View>
  );
}

// PHASE 5: Wrap with ErrorBoundary + ProfileScreenGuard for crash protection
export default function ProfileScreen() {
  const router = useRouter();
  const user = useAuthStore((state) => state.user);
  const {
    isLoading: isLoadingProfile,
    isError: isProfileError,
    error: profileError,
    refetch: refetchProfile,
  } = useMyProfile();

  return (
    <ErrorBoundary
      screenName="Profile"
      onGoHome={() => router.replace("/(protected)/(tabs)/feed" as any)}
      debugContext={{
        userId: user?.id ? String(user.id) : undefined,
        queryKeys: [
          "authUser",
          `profile-${user?.id || "unknown"}`,
          `profilePosts-${user?.id || "unknown"}`,
          "bookmarks",
        ],
      }}
    >
      <ProfileScreenGuard
        isLoading={isLoadingProfile}
        isError={isProfileError}
        error={profileError}
        onRetry={refetchProfile}
      >
        <ProfileScreenContent />
      </ProfileScreenGuard>
    </ErrorBoundary>
  );
}
