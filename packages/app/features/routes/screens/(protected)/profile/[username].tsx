import {
  View,
  Text,
  ScrollView,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  Modal,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  ArrowLeft,
  Grid,
  MoreHorizontal,
  Share2,
  X,
} from "lucide-react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useColorScheme } from "@dvnt/app/lib/hooks";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import { useAppStore } from "@dvnt/app/lib/stores/app-store";
import { shareProfile } from "@dvnt/app/lib/utils/sharing";
import { Motion } from "@legendapp/motion";
import { ErrorBoundary } from "@dvnt/app/components/error-boundary";
import { ProfileActionSheet } from "@dvnt/app/components/profile-action-sheet";
import { useReportSheetStore } from "@dvnt/app/lib/stores/report-sheet-store";
import { Skeleton } from "@dvnt/app/components/ui/skeleton";

import { useCallback, memo, useState, useMemo, useEffect, useRef } from "react";
import { useUser, useFollow } from "@dvnt/app/lib/hooks";
import { useProfilePosts } from "@dvnt/app/lib/hooks/use-posts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { screenPrefetch } from "@dvnt/app/lib/prefetch";
import { usersApi } from "@dvnt/app/lib/api/users";
import { messagesApiClient } from "@dvnt/app/lib/api/messages";
import { useUIStore } from "@dvnt/app/lib/stores/ui-store";
import { navigateToChat } from "@dvnt/app/lib/navigation/chat-routes";
import { Avatar, AvatarSizes } from "@dvnt/app/components/ui/avatar";
import { resolveAvatarUrl } from "@dvnt/app/lib/media/resolveAvatarUrl";
import { Image } from "expo-image";
import { Debouncer } from "@tanstack/react-pacer";
import { ProfileMasonryGrid } from "@dvnt/app/components/profile/ProfileMasonryGrid";
import { ProfilePronounsPill } from "@dvnt/app/components/profile/ProfilePronounsPill";
import {
  safeGridTiles,
  type SafeGridTile,
} from "@dvnt/app/lib/utils/safe-profile-mappers";

const GRID_GAP = 2;

interface MockUser {
  id?: string;
  username: string;
  fullName: string;
  name?: string;
  avatar: string;
  bio: string;
  postsCount: number;
  followersCount: number;
  followingCount: number;
}

const mockUsers: Record<string, MockUser> = {
  emma_wilson: {
    id: "mock-emma",
    username: "emma_wilson",
    fullName: "Emma Wilson",
    name: "Emma Wilson",
    avatar: "https://i.pravatar.cc/150?img=5",
    bio: "Travel enthusiast 🌍\nPhotography lover 📸",
    postsCount: 234,
    followersCount: 12500,
    followingCount: 456,
  },
  john_fitness: {
    id: "mock-john",
    username: "john_fitness",
    fullName: "John Fitness",
    name: "John Fitness",
    avatar: "https://i.pravatar.cc/150?img=17",
    bio: "Fitness coach 💪\nHelping you reach your goals",
    postsCount: 189,
    followersCount: 45000,
    followingCount: 234,
  },
  sarah_artist: {
    id: "mock-sarah",
    username: "sarah_artist",
    fullName: "Sarah Artist",
    name: "Sarah Artist",
    avatar: "https://i.pravatar.cc/150?img=14",
    bio: "Digital artist 🎨\nCommissions open",
    postsCount: 567,
    followersCount: 8900,
    followingCount: 123,
  },
  naturephoto: {
    id: "mock-nature",
    username: "naturephoto",
    fullName: "Nature Photography",
    name: "Nature Photography",
    avatar: "https://i.pravatar.cc/150?img=13",
    bio: "Capturing the beauty of our planet 🌿\nSony Ambassador | DM for prints",
    postsCount: 892,
    followersCount: 156000,
    followingCount: 312,
  },
  urban_explorer: {
    id: "mock-urban",
    username: "urban_explorer",
    fullName: "Urban Explorer",
    name: "Urban Explorer",
    avatar: "https://i.pravatar.cc/150?img=8",
    bio: "Street photography | City vibes 🏙️\nBased in Tokyo & NYC",
    postsCount: 445,
    followersCount: 67800,
    followingCount: 189,
  },
  foodie_adventures: {
    id: "mock-foodie",
    username: "foodie_adventures",
    fullName: "Foodie Adventures",
    name: "Foodie Adventures",
    avatar: "https://i.pravatar.cc/150?img=9",
    bio: "Eating my way around the world 🍜\nMichelin hunter | Food blogger",
    postsCount: 678,
    followersCount: 89400,
    followingCount: 445,
  },
  travel_with_me: {
    id: "mock-travel",
    username: "travel_with_me",
    fullName: "Sarah Anderson",
    name: "Sarah Anderson",
    avatar: "https://i.pravatar.cc/150?img=10",
    bio: "Full-time traveler ✈️\n50+ countries | Content creator",
    postsCount: 1234,
    followersCount: 234000,
    followingCount: 567,
  },
  coffee_culture: {
    id: "mock-coffee",
    username: "coffee_culture",
    fullName: "Marcus Chen",
    name: "Marcus Chen",
    avatar: "https://i.pravatar.cc/150?img=31",
    bio: "Coffee enthusiast ☕\nBarista | Roaster | Educator",
    postsCount: 312,
    followersCount: 28900,
    followingCount: 234,
  },
  street_style: {
    id: "mock-street",
    username: "street_style",
    fullName: "Olivia Park",
    name: "Olivia Park",
    avatar: "https://i.pravatar.cc/150?img=33",
    bio: "Fashion designer 👗\nSeoul | Paris | NYC\nShop link below ⬇️",
    postsCount: 567,
    followersCount: 445000,
    followingCount: 178,
  },
  astro_captures: {
    id: "mock-astro",
    username: "astro_captures",
    fullName: "David Starr",
    name: "David Starr",
    avatar: "https://i.pravatar.cc/150?img=35",
    bio: "Astrophotographer 🌌\nChasing the cosmos one photo at a time",
    postsCount: 234,
    followersCount: 178000,
    followingCount: 89,
  },
  pet_paradise: {
    id: "mock-pet",
    username: "pet_paradise",
    fullName: "Luna & Max",
    name: "Luna & Max",
    avatar: "https://i.pravatar.cc/150?img=37",
    bio: "Two rescue pups living their best life 🐕\nAdopt don't shop!",
    postsCount: 445,
    followersCount: 123000,
    followingCount: 567,
  },
  minimalist_home: {
    id: "mock-minimalist",
    username: "minimalist_home",
    fullName: "Interior Studio",
    name: "Interior Studio",
    avatar: "https://i.pravatar.cc/150?img=40",
    bio: "Interior design studio 🏠\nScandinavian inspired | Less is more",
    postsCount: 289,
    followersCount: 67800,
    followingCount: 156,
  },
};

const mockPosts = [
  {
    id: "1",
    thumbnail:
      "https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=800",
  },
  {
    id: "2",
    thumbnail:
      "https://images.unsplash.com/photo-1512621776950-296cd0d26b37?w=800",
  },
  {
    id: "3",
    thumbnail:
      "https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=800",
  },
  {
    id: "4",
    thumbnail:
      "https://images.unsplash.com/photo-1519681393784-d120267933ba?w=800",
  },
  {
    id: "5",
    thumbnail:
      "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=800",
  },
  {
    id: "6",
    thumbnail:
      "https://images.unsplash.com/photo-1480714378408-67cf0d13bc1b?w=800",
  },
  {
    id: "f1",
    thumbnail:
      "https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?w=800",
  },
  {
    id: "f2",
    thumbnail:
      "https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?w=800",
  },
  {
    id: "f3",
    thumbnail:
      "https://images.unsplash.com/photo-1462331940025-496dfbfc7564?w=800",
  },
  {
    id: "f4",
    thumbnail:
      "https://images.unsplash.com/photo-1587300003388-59208cc962cb?w=800",
  },
  {
    id: "f5",
    thumbnail:
      "https://images.unsplash.com/photo-1586023492125-27b2c045efd7?w=800",
  },
  {
    id: "f6",
    thumbnail:
      "https://images.unsplash.com/photo-1603048588665-791ca8aea617?w=800",
  },
  {
    id: "f7",
    thumbnail:
      "https://images.unsplash.com/photo-1447752875215-b2761acb3c5d?w=800",
  },
  {
    id: "f8",
    thumbnail:
      "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=800",
  },
  {
    id: "f9",
    thumbnail:
      "https://images.unsplash.com/photo-1501785888041-af3ef285b470?w=800",
  },
];

function normalizeRouteParam(value: string | string[] | undefined) {
  if (!value) return undefined;
  return Array.isArray(value) ? value[0] : value;
}

function parseBooleanParam(value: string | string[] | undefined) {
  const normalized = normalizeRouteParam(value);
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  return undefined;
}

function parseCountParam(value: string | string[] | undefined) {
  const normalized = normalizeRouteParam(value);
  if (!normalized) return undefined;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function mergeDefinedUser<
  T extends Record<string, string | number | boolean | undefined | null>,
>(base: T, incoming?: Record<string, unknown> | null): T {
  if (!incoming) return base;

  const next = { ...base };
  for (const [key, value] of Object.entries(incoming)) {
    if (value === undefined || value === null) continue;
    if (
      typeof value === "string" &&
      value.length === 0 &&
      typeof next[key] === "string" &&
      String(next[key]).length > 0
    ) {
      continue;
    }
    next[key as keyof T] = value as T[keyof T];
  }

  return next;
}

function UserProfileScreenComponent() {
  const {
    username,
    userId: userIdParam,
    authId,
    avatar: avatarParam,
    name: nameParam,
    isFollowing: isFollowingParam,
    postsCount: postsCountParam,
    followersCount: followersCountParam,
    followingCount: followingCountParam,
  } = useLocalSearchParams<{
    username: string;
    userId?: string;
    authId?: string;
    avatar?: string;
    name?: string;
    isFollowing?: string;
    postsCount?: string;
    followersCount?: string;
    followingCount?: string;
  }>();
  const router = useRouter();
  const { colors } = useColorScheme();
  const nsfwEnabled = useAppStore((state) => state.nsfwEnabled);
  const currentUser = useAuthStore((state) => state.user);
  const queryClient = useQueryClient();

  // Responsive grid: 2 columns on phone, 3 on tablet (768px+), 4 on large (1024px+)
  const { width: screenWidth } = useWindowDimensions();
  const numColumns = screenWidth >= 1024 ? 4 : screenWidth >= 768 ? 3 : 2;
  const columnWidth = (screenWidth - GRID_GAP * (numColumns + 1)) / numColumns;

  // DEFENSIVE: Ensure username is a valid string
  const safeUsername =
    typeof username === "string" && username.length > 0 ? username : null;
  const previewUserId = normalizeRouteParam(userIdParam);
  const previewAuthId = normalizeRouteParam(authId);
  const previewAvatar = normalizeRouteParam(avatarParam);
  const previewName = normalizeRouteParam(nameParam);
  const previewIsFollowing = parseBooleanParam(isFollowingParam);
  const previewPostsCount = parseCountParam(postsCountParam);
  const previewFollowersCount = parseCountParam(followersCountParam);
  const previewFollowingCount = parseCountParam(followingCountParam);

  const isOwnProfile = currentUser?.username === safeUsername;

  // Fetch user data from app `users` table
  const {
    data: userData,
    isLoading: isLoadingUser,
    isError,
    error,
    isPlaceholderData: isPlaceholderUserData,
  } = useUser(safeUsername || "");

  // Fallback: fetch from Better Auth `user` table if no app profile found
  const { data: authUserData, isLoading: isLoadingAuthUser } = useQuery({
    queryKey: ["auth-user", previewAuthId],
    queryFn: () => usersApi.getProfileByAuthUserId(previewAuthId!),
    enabled: !!previewAuthId && !userData && !isLoadingUser,
    refetchOnMount: "always",
  });

  // Merge: prefer app profile, fall back to auth user
  const resolvedUserData = userData || authUserData;
  const isLoading =
    isLoadingUser || (!userData && !!previewAuthId && isLoadingAuthUser);

  const resolvedFollowState =
    !isPlaceholderUserData &&
    typeof (resolvedUserData as any)?.isFollowing === "boolean"
      ? Boolean((resolvedUserData as any)?.isFollowing)
      : previewIsFollowing;
  const isFollowing = resolvedFollowState === true;

  const shouldKeepPreviewCounts =
    isPlaceholderUserData &&
    (previewPostsCount !== undefined ||
      previewFollowersCount !== undefined ||
      previewFollowingCount !== undefined);

  const resolvedCounts = shouldKeepPreviewCounts
    ? {
        postsCount: previewPostsCount,
        followersCount: previewFollowersCount,
        followingCount: previewFollowingCount,
      }
    : {
        postsCount:
          typeof (resolvedUserData as any)?.postsCount === "number"
            ? (resolvedUserData as any).postsCount
            : previewPostsCount,
        followersCount:
          typeof (resolvedUserData as any)?.followersCount === "number"
            ? (resolvedUserData as any).followersCount
            : previewFollowersCount,
        followingCount:
          typeof (resolvedUserData as any)?.followingCount === "number"
            ? (resolvedUserData as any).followingCount
            : previewFollowingCount,
      };

  // Fetch user posts — fires in parallel with user query (no waterfall)
  const { data: userPostsRaw = [], isLoading: isLoadingPosts } =
    useProfilePosts(safeUsername || "");

  // Transform to masonry grid tiles
  const visibleUserPosts = useMemo(
    () =>
      nsfwEnabled
        ? userPostsRaw
        : userPostsRaw.filter((post) => !post.isNSFW),
    [userPostsRaw, nsfwEnabled],
  );

  const userPosts: SafeGridTile[] = useMemo(
    () => safeGridTiles(visibleUserPosts),
    [visibleUserPosts],
  );

  const {
    mutate: followMutate,
    isPending: isFollowPending,
    variables: followVars,
  } = useFollow();

  // Get userId for follow queries
  const userId = (resolvedUserData as any)?.id;

  // Eager prefetch followers/following when profile resolves — data in cache before user taps
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

  // CRITICAL: Redirect to tabs profile if viewing own profile
  // This ensures consistent UI/UX and correct avatar display
  useEffect(() => {
    if (isOwnProfile) {
      router.replace("/(protected)/(tabs)/profile");
    }
  }, [isOwnProfile, router]);

  // Use API data or fallback to route params — renders INSTANTLY without waiting for query.
  // Route params (username, avatarParam, nameParam) are available synchronously on mount.
  const basePreviewUser: {
    id?: string;
    authId?: string;
    username: string;
    fullName?: string;
    name?: string;
    avatar?: string;
    bio?: string;
    postsCount?: number;
    followersCount?: number;
    followingCount?: number;
    isFollowing?: boolean;
  } = {
    id: previewUserId,
    authId: previewAuthId,
    username: safeUsername || "",
    fullName: previewName || "",
    name: previewName || "",
    avatar: previewAvatar || undefined,
    bio: "",
    postsCount: resolvedCounts.postsCount,
    followersCount: resolvedCounts.followersCount,
    followingCount: resolvedCounts.followingCount,
    isFollowing: resolvedFollowState,
  };
  const mergeableResolvedUserData =
    isPlaceholderUserData && resolvedUserData
      ? {
          ...(resolvedUserData as Record<string, unknown>),
          postsCount: resolvedCounts.postsCount,
          followersCount: resolvedCounts.followersCount,
          followingCount: resolvedCounts.followingCount,
          isFollowing: resolvedFollowState,
        }
      : (resolvedUserData as Record<string, unknown> | undefined);
  const rawUser = mergeDefinedUser(
    mergeDefinedUser(
      basePreviewUser,
      mockUsers[username || ""] as unknown as
        | Record<string, unknown>
        | undefined,
    ),
    mergeableResolvedUserData,
  );

  // CRITICAL: For own profile, prefer auth store avatar (optimistically updated)
  // over the useUser cache which may be stale after an avatar change.
  // NEVER use currentUser.avatar as fallback for OTHER users — that leaks viewer's avatar
  // avatarParam from route is available INSTANTLY (no query needed) — eliminates waterfall
  const resolvedAvatar = isOwnProfile
    ? currentUser?.avatar ||
      (rawUser.avatar && rawUser.avatar.length > 0 ? rawUser.avatar : null)
    : (rawUser.avatar && rawUser.avatar.length > 0 ? rawUser.avatar : null) ||
      (previewAvatar && previewAvatar.length > 0 ? previewAvatar : null);
  const user = { ...rawUser, avatar: resolvedAvatar || undefined };
  const profileAvatarUrl = resolveAvatarUrl(
    user.avatar,
    __DEV__ ? `Profile:${user.username}` : undefined,
  );
  const displayPostsCount =
    typeof user.postsCount === "number"
      ? user.postsCount
      : !isLoadingPosts
        ? userPosts.length
        : undefined;
  const displayFollowersCount =
    typeof user.followersCount === "number" ? user.followersCount : undefined;
  const displayFollowingCount =
    typeof user.followingCount === "number" ? user.followingCount : undefined;
  const isFollowStateLoading =
    !isOwnProfile && typeof resolvedFollowState !== "boolean" && isLoading;

  // Create a followMutation-like object for compatibility
  const followMutation = {
    isPending: isFollowPending,
    mutate: followMutate,
  };
  const followTargetId = String(
    (user as any).authId || user.id || previewAuthId || "",
  );
  const messageTargetId = String(
    (user as any).authId || user.id || previewAuthId || "",
  );

  const handleFollowPress = useCallback(() => {
    if (!followTargetId || !username) return;

    const action = isFollowing ? "unfollow" : "follow";
    followMutate({ userId: followTargetId, action, username });
  }, [followMutate, followTargetId, isFollowing, username]);

  // State for message button loading
  const [isCreatingConversation, setIsCreatingConversation] = useState(false);
  const [menuVisible, setMenuVisible] = useState(false);
  const [isAvatarViewerOpen, setIsAvatarViewerOpen] = useState(false);
  const showToast = useUIStore((s) => s.showToast);
  const creatingConvRef = useRef(false);

  // Safety timeout: reset loading state if the call hangs for 10s
  const safetyResetRef = useRef(
    new Debouncer(
      () => {
        if (creatingConvRef.current) {
          console.warn("[Profile] Message button safety timeout — resetting");
          creatingConvRef.current = false;
          setIsCreatingConversation(false);
        }
      },
      { wait: 10000 },
    ),
  );

  const handleMessagePress = useCallback(async () => {
    if (!messageTargetId || creatingConvRef.current) return;

    // Fast path 1: check conversations cache for existing numeric conversation ID
    const allConvCaches = queryClient.getQueriesData<any[]>({
      queryKey: ["messages"],
    });
    for (const [, data] of allConvCaches) {
      if (!Array.isArray(data)) continue;
      const match = data.find(
        (c: any) =>
          !c?.isGroup &&
          (c?.user?.id === String(user.id) ||
            c?.user?.authId ===
              String((user as any).authId || previewAuthId || "") ||
            c?.user?.authId === messageTargetId ||
            c?.user?.username === username),
      );
      if (match?.id) {
        console.log("[Profile] Cache hit — navigating to chat:", match.id);
        navigateToChat(router, {
          conversationId: String(match.id),
          peerUsername: user.username,
          peerName: user.name || user.username,
          peerAvatar: user.avatar || "",
        });
        return;
      }
    }

    // Fast path 2: prefetch conversation resolution, then navigate with username
    // The prefetch populates the TanStack Query cache so the chat screen
    // reads the conversation ID instantly without waiting for edge function.
    if (username) {
      console.log(
        "[Profile] Prefetching conversation resolution for:",
        username,
      );
      const { prefetchConversationResolution } =
        await import("@dvnt/app/lib/hooks/use-conversation-resolution");

      const conversationId = await prefetchConversationResolution(
        queryClient,
        username,
      );

      if (conversationId) {
        navigateToChat(router, {
          conversationId,
          peerUsername: username,
          peerName: user.name || username,
          peerAvatar: user.avatar || "",
        });
        return;
      }
    }

    // Fallback: no username — must call edge function (rare)
    creatingConvRef.current = true;
    setIsCreatingConversation(true);
    safetyResetRef.current.maybeExecute();
    try {
      // CRITICAL: Must pass authId (UUID) or integer user.id, NOT username
      const identifier = messageTargetId;

      // DEFENSIVE CHECK: Ensure we're not accidentally passing username
      if (
        !identifier ||
        (typeof identifier === "string" &&
          !/^(\d+|[0-9a-f-]{36})$/i.test(identifier))
      ) {
        console.error(
          "[Profile] Invalid identifier for conversation creation:",
          {
            identifier,
            userId: user.id,
            username: user.username,
            authId: (user as any).authId,
          },
        );
        throw new Error(
          "Unable to create conversation - invalid user identifier",
        );
      }

      const conversationId =
        await messagesApiClient.getOrCreateConversation(identifier);
      if (conversationId) {
        navigateToChat(router, {
          conversationId,
          peerAvatar: user.avatar,
          peerUsername: user.username,
          peerName: user.name || user.username,
        });
      } else {
        showToast("error", "Error", "Could not start conversation");
      }
    } catch (error: any) {
      console.error("[Profile] Message error:", error);
      showToast(
        "error",
        "Error",
        error?.message || "Failed to start conversation",
      );
    } finally {
      safetyResetRef.current.cancel();
      creatingConvRef.current = false;
      setIsCreatingConversation(false);
    }
  }, [
    previewAuthId,
    messageTargetId,
    user.id,
    user.username,
    user.name,
    user.avatar,
    username,
    router,
    showToast,
    queryClient,
  ]);

  // DEFENSIVE: Early return for missing username - show safe error state
  if (!safeUsername) {
    return (
      <SafeAreaView edges={["top"]} className="flex-1 bg-background">
        <View className="flex-row items-center justify-between border-b border-border px-4 py-3">
          <Pressable
            onPress={() => router.back()}
            hitSlop={16}
            style={{ padding: 8, margin: -8, marginRight: 8 }}
          >
            <ArrowLeft size={24} color={colors.foreground} />
          </Pressable>
          <Text className="text-lg font-semibold text-foreground">Profile</Text>
          <View style={{ width: 24 }} />
        </View>
        <View className="flex-1 items-center justify-center p-4">
          <Text className="text-muted-foreground">User not found</Text>
          <Pressable
            onPress={() => router.back()}
            hitSlop={12}
            className="mt-4"
          >
            <Text className="text-primary">Go Back</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  // DEFENSIVE: Show error state if API failed (but don't crash)
  if (isError && !userData) {
    console.error("[Profile] API error:", error);
    // Continue rendering with fallback data instead of crashing
  }

  return (
    <SafeAreaView
      edges={["top"]}
      className="flex-1 bg-background max-w-3xl w-full self-center"
    >
      {/* Header */}
      <View
        className="flex-row items-center justify-between border-b border-border px-4 py-1"
        style={{ zIndex: 10 }}
      >
        <Pressable
          onPress={() => router.back()}
          hitSlop={8}
          style={{
            width: 44,
            height: 44,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <ArrowLeft size={24} color={colors.foreground} />
        </Pressable>
        <Text className="text-lg font-semibold text-foreground">
          {user.username || safeUsername || "Profile"}
        </Text>
        <Pressable
          onPress={() => setMenuVisible(true)}
          hitSlop={8}
          style={{
            width: 44,
            height: 44,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <MoreHorizontal size={24} color={colors.foreground} />
        </Pressable>
      </View>

      {/* Profile Action Sheet */}
      <ProfileActionSheet
        visible={menuVisible}
        onClose={() => setMenuVisible(false)}
        username={user.username}
        onShareProfile={() => {
          shareProfile(user.username, user.name || user.username);
        }}
        onAddCloseFriend={() => {
          showToast(
            "success",
            "Close Friends",
            `@${user.username} added to Close Friends`,
          );
        }}
        onReport={() => {
          // App Store Guideline 1.2 — every UGC surface needs a working
          // report path. Opens the global ReportSheet via the shared store.
          const reportId =
            (user as any).authId || (user.id != null ? String(user.id) : "");
          if (!reportId) {
            showToast("error", "Report", "Couldn't load this user — try again.");
            return;
          }
          useReportSheetStore.getState().openReportSheet({
            entityType: "profile",
            entityId: reportId,
            label: `@${user.username}`,
          });
        }}
        onBlock={() => {
          // Short, single-line confirmation — the user chose this
          // explicitly from the menu, so a terse toast is appropriate.
          showToast("success", `Blocked @${user.username}`, "");
        }}
      />

      <ScrollView showsVerticalScrollIndicator={false}>
        {/* Profile Info - Centered */}
        <View className="p-4">
          <View className="items-center">
            <View className="flex-row items-center justify-center gap-8 mb-6">
              {profileAvatarUrl ? (
                <Pressable
                  onPress={() => setIsAvatarViewerOpen(true)}
                  hitSlop={10}
                >
                  <Avatar
                    uri={profileAvatarUrl}
                    username={user.username}
                    size={80}
                    variant="roundedSquare"
                  />
                </Pressable>
              ) : (
                <Avatar
                  uri={undefined}
                  username={user.username}
                  size={80}
                  variant="roundedSquare"
                />
              )}
              <View className="flex-row gap-8">
                <View className="items-center">
                  {typeof displayPostsCount === "number" ? (
                    <Text className="text-lg font-bold text-foreground">
                      {displayPostsCount}
                    </Text>
                  ) : isLoading ? (
                    <Skeleton
                      style={{ width: 28, height: 22, borderRadius: 6 }}
                    />
                  ) : (
                    <Text className="text-lg font-bold text-foreground">0</Text>
                  )}
                  <Text className="text-xs text-muted-foreground">Posts</Text>
                </View>
                <Pressable
                  className="items-center"
                  onPress={() => {
                    if (userId) {
                      // Prefetch before navigation — data in cache when screen mounts
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
                      router.push(
                        `/(protected)/profile/followers?userId=${userId}&username=${user.username}`,
                      );
                    }
                  }}
                >
                  {typeof displayFollowersCount === "number" ? (
                    <Text className="text-lg font-bold text-foreground">
                      {displayFollowersCount >= 1000
                        ? `${(displayFollowersCount / 1000).toFixed(1)}K`
                        : displayFollowersCount}
                    </Text>
                  ) : isLoading ? (
                    <Skeleton
                      style={{ width: 40, height: 22, borderRadius: 6 }}
                    />
                  ) : (
                    <Text className="text-lg font-bold text-foreground">-</Text>
                  )}
                  <Text className="text-xs text-muted-foreground">
                    Followers
                  </Text>
                </Pressable>
                <Pressable
                  className="items-center"
                  onPress={() => {
                    if (userId) {
                      // Prefetch before navigation — data in cache when screen mounts
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
                      router.push(
                        `/(protected)/profile/following?userId=${userId}&username=${user.username}`,
                      );
                    }
                  }}
                >
                  {typeof displayFollowingCount === "number" ? (
                    <Text className="text-lg font-bold text-foreground">
                      {displayFollowingCount}
                    </Text>
                  ) : isLoading ? (
                    <Skeleton
                      style={{ width: 40, height: 22, borderRadius: 6 }}
                    />
                  ) : (
                    <Text className="text-lg font-bold text-foreground">-</Text>
                  )}
                  <Text className="text-xs text-muted-foreground">
                    Following
                  </Text>
                </Pressable>
              </View>
            </View>
          </View>

          <View className="mt-4">
            <View className="flex-row flex-wrap items-center gap-2">
              <Text className="font-semibold text-foreground">
                {user.name || user.username}
              </Text>
              <ProfilePronounsPill
                pronouns={(user as any).pronouns}
                inline
              />
            </View>
            {user.bio && (
              <Text className="mt-1 text-sm text-foreground/90">
                {user.bio}
              </Text>
            )}
          </View>

          {/* Action Buttons */}
          <View className="mt-4 flex-row gap-2">
            {isOwnProfile ? (
              <>
                <Pressable
                  onPress={() =>
                    router.push("/(protected)/edit-profile" as any)
                  }
                  style={{ flex: 1 }}
                >
                  <Motion.View
                    whileTap={{ scale: 0.95 }}
                    transition={{ type: "spring", damping: 15, stiffness: 400 }}
                    style={styles.secondaryButton}
                  >
                    <Text className="font-semibold text-secondary-foreground">
                      Edit Profile
                    </Text>
                  </Motion.View>
                </Pressable>
                <Pressable
                  onPress={() =>
                    shareProfile(user.username, user.name || user.username)
                  }
                  style={styles.shareButton}
                >
                  <Motion.View
                    whileTap={{ scale: 0.95 }}
                    transition={{ type: "spring", damping: 15, stiffness: 400 }}
                  >
                    <Share2 size={20} color="#fff" />
                  </Motion.View>
                </Pressable>
              </>
            ) : (
              <>
                {isFollowStateLoading ? (
                  <View style={{ flex: 1 }}>
                    <Skeleton
                      style={{ width: "100%", height: 44, borderRadius: 8 }}
                    />
                  </View>
                ) : (
                  <Pressable
                    onPress={handleFollowPress}
                    disabled={followMutation.isPending || !followTargetId}
                    style={{ flex: 1 }}
                  >
                    <Motion.View
                      whileTap={{ scale: 0.95 }}
                      transition={{
                        type: "spring",
                        damping: 15,
                        stiffness: 400,
                      }}
                      style={[
                        styles.primaryButton,
                        isFollowing && styles.secondaryButton,
                        (followMutation.isPending || !followTargetId) && {
                          opacity: 0.5,
                        },
                      ]}
                    >
                      <Text
                        className={`font-semibold ${isFollowing ? "text-secondary-foreground" : "text-primary-foreground"}`}
                      >
                        {followMutation.isPending
                          ? followVars?.action === "follow"
                            ? "Now Following"
                            : "Unfollowing..."
                          : isFollowing
                            ? "Following"
                            : "Follow"}
                      </Text>
                    </Motion.View>
                  </Pressable>
                )}
                <Pressable
                  onPress={handleMessagePress}
                  disabled={isCreatingConversation || !messageTargetId}
                  style={{ flex: 1 }}
                >
                  <Motion.View
                    whileTap={{ scale: 0.95 }}
                    transition={{ type: "spring", damping: 15, stiffness: 400 }}
                    style={[
                      styles.secondaryButton,
                      (isCreatingConversation || !messageTargetId) && {
                        opacity: 0.5,
                      },
                    ]}
                  >
                    <Text className="font-semibold text-secondary-foreground">
                      {isCreatingConversation ? "Opening..." : "Message"}
                    </Text>
                  </Motion.View>
                </Pressable>
              </>
            )}
          </View>
        </View>

        {/* Tab Bar */}
        <View className="flex-row border-b border-border">
          <Pressable className="flex-1 items-center border-b-2 border-foreground py-3">
            <Grid size={24} color={colors.foreground} />
          </Pressable>
        </View>

        {/* Posts Grid — Masonry */}
        {isLoading || isLoadingPosts ? (
          <View className="flex-row flex-wrap">
            {Array.from({ length: 6 }).map((_, i) => (
              <View
                key={i}
                style={{ width: columnWidth, height: columnWidth, padding: 1 }}
              >
                <Skeleton
                  style={{ width: "100%", height: "100%", borderRadius: 8 }}
                />
              </View>
            ))}
          </View>
        ) : (
          <ProfileMasonryGrid
            data={userPosts}
            userId={userId}
            scrollEnabled={false}
            ListEmptyComponent={
              <View className="p-4 items-center flex-1">
                <Text className="text-muted-foreground">No posts yet</Text>
              </View>
            }
          />
        )}
      </ScrollView>

      <Modal
        visible={isAvatarViewerOpen && !!profileAvatarUrl}
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
            {profileAvatarUrl ? (
              <Image
                source={{ uri: profileAvatarUrl }}
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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
  },
  primaryButton: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 8,
    backgroundColor: "#3EA4E5",
    paddingVertical: 10,
    paddingHorizontal: 24,
  },
  secondaryButton: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 8,
    backgroundColor: "#1a1a1a",
    paddingVertical: 10,
    paddingHorizontal: 24,
  },
  postContainer: {
    flex: 1,
    margin: 2,
    overflow: "hidden",
    backgroundColor: "#1a1a1a",
    borderRadius: 4,
  },
  postImage: {
    width: "100%",
    height: "100%",
  },
  shareButton: {
    width: 44,
    height: 44,
    borderRadius: 8,
    backgroundColor: "#1a1a1a",
    alignItems: "center",
    justifyContent: "center",
  },
});

// Wrap with ErrorBoundary for crash protection
function UserProfileScreen() {
  const router = useRouter();

  return (
    <ErrorBoundary
      screenName="Profile"
      onGoHome={() => router.replace("/(protected)/(tabs)/feed" as any)}
    >
      <UserProfileScreenComponent />
    </ErrorBoundary>
  );
}

export default memo(UserProfileScreen);
