/**
 * Profile Hooks
 *
 * CRITICAL: These hooks provide the canonical read path for profile data.
 *
 * useMyProfile - Fetches current user's profile with counts
 * useUpdateProfile - Mutation to update profile with proper cache sync
 */

import {
  useQuery,
  useMutation,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { usersApi } from "@/lib/api/users";
import { useAuthStore } from "@/lib/stores/auth-store";
import { postKeys } from "@/lib/hooks/use-posts";
import { resolveAvatarUrl } from "@/lib/media/resolveAvatarUrl";
import { STALE_TIMES } from "@/lib/perf/stale-time-config";
import type { AppUser } from "@/lib/auth-client";

// Query keys - MUST be scoped by userId
export const profileKeys = {
  all: ["profile"] as const,
  byId: (userId: string) => ["profile", userId] as const,
  byUsername: (username: string) => ["profile", "username", username] as const,
};

export interface ProfileData {
  id: string;
  username: string;
  name?: string;
  displayName?: string;
  bio?: string;
  avatar?: string;
  avatarUrl?: string;
  website?: string;
  links?: string[];
  location?: string;
  pronouns?: string;
  gender?: string;
  hashtags?: string[];
  verified?: boolean;
  followersCount: number;
  followingCount: number;
  postsCount: number;
  isFollowing?: boolean;
  isFollowedBy?: boolean;
  isOwnProfile?: boolean;
}

type UpdateProfileInput = {
  name?: string;
  bio?: string;
  website?: string;
  links?: string[];
  avatar?: string;
  location?: string;
  pronouns?: string;
  gender?: string;
  hashtags?: string[];
  username?: string;
};

type UpdateProfileContext = {
  userId?: string;
  previousAuthUser?: AppUser;
  optimisticUser?: AppUser;
  previousProfile?: ProfileData;
  previousProfileByUsername?: unknown;
  previousNextProfileByUsername?: unknown;
  previousUserByUsername?: unknown;
  previousNextUserByUsername?: unknown;
  previousFeed?: unknown;
  previousInfiniteFeed?: unknown;
  previousProfilePosts?: unknown;
  previousStories?: unknown;
  previousStoriesList?: unknown;
};

function restoreQueryData(
  queryClient: QueryClient,
  queryKey: readonly unknown[],
  previousData: unknown,
) {
  if (previousData === undefined) {
    queryClient.removeQueries({ queryKey, exact: true });
    return;
  }
  queryClient.setQueryData(queryKey, previousData);
}

function buildProfileCacheData(
  previous: ProfileData | undefined,
  user: AppUser,
): ProfileData {
  return {
    id: String(user.id),
    username: user.username,
    name: user.name || user.username,
    displayName: user.name || user.username,
    bio: user.bio || undefined,
    avatar: user.avatar || undefined,
    avatarUrl: user.avatar || undefined,
    website: user.website || undefined,
    links: user.links,
    location: user.location || undefined,
    pronouns: user.pronouns || undefined,
    gender: user.gender || undefined,
    hashtags: user.hashtags,
    verified: previous?.verified ?? user.isVerified,
    followersCount: previous?.followersCount ?? user.followersCount ?? 0,
    followingCount: previous?.followingCount ?? user.followingCount ?? 0,
    postsCount: previous?.postsCount ?? user.postsCount ?? 0,
    isFollowing: previous?.isFollowing,
    isFollowedBy: previous?.isFollowedBy,
    isOwnProfile: previous?.isOwnProfile ?? true,
  };
}

function buildUserCacheData(previous: any, user: AppUser) {
  return {
    ...previous,
    id: String(user.id),
    authId: previous?.authId ?? user.authId,
    username: user.username,
    email: previous?.email ?? user.email,
    firstName: previous?.firstName ?? user.name,
    lastName: previous?.lastName ?? "",
    name: user.name || user.username,
    bio: user.bio || "",
    location: user.location || null,
    website: user.website || "",
    links: user.links || [],
    pronouns: user.pronouns || "",
    gender: user.gender || "",
    avatar: user.avatar || "",
    verified: previous?.verified ?? user.isVerified,
    followersCount: previous?.followersCount ?? user.followersCount ?? 0,
    followingCount: previous?.followingCount ?? user.followingCount ?? 0,
    postsCount: previous?.postsCount ?? user.postsCount ?? 0,
    isOwnProfile: true,
  };
}

function patchCurrentUserEverywhere(
  queryClient: QueryClient,
  previousUser: AppUser,
  nextUser: AppUser,
) {
  const userId = String(previousUser.id);
  const previousUsername = previousUser.username;
  const nextUsername = nextUser.username;
  const knownUsernames = Array.from(
    new Set([previousUsername, nextUsername].filter(Boolean)),
  ).map((value) => value.toLowerCase());

  const isOwnedByCurrentUser = (entity: {
    userId?: unknown;
    username?: unknown;
  }) => {
    if (String(entity.userId || "") === userId) return true;
    if (typeof entity.username !== "string") return false;
    return knownUsernames.includes(entity.username.toLowerCase());
  };

  queryClient.setQueryData<ProfileData | undefined>(
    profileKeys.byId(userId),
    (old) => buildProfileCacheData(old, nextUser),
  );

  const previousProfileKey = previousUsername
    ? profileKeys.byUsername(previousUsername)
    : null;
  if (previousProfileKey && queryClient.getQueryState(previousProfileKey)) {
    queryClient.setQueryData<ProfileData | undefined>(
      previousProfileKey,
      (old) => buildProfileCacheData(old, nextUser),
    );
  }

  if (nextUsername) {
    queryClient.setQueryData<ProfileData | undefined>(
      profileKeys.byUsername(nextUsername),
      (old) => buildProfileCacheData(old, nextUser),
    );
  }

  const previousUserKey = previousUsername
    ? (["users", "username", previousUsername] as const)
    : null;
  if (previousUserKey && queryClient.getQueryState(previousUserKey)) {
    queryClient.setQueryData(previousUserKey, (old: any) =>
      buildUserCacheData(old, nextUser),
    );
  }

  if (nextUsername) {
    queryClient.setQueryData(["users", "username", nextUsername], (old: any) =>
      buildUserCacheData(old, nextUser),
    );
  }

  const patchPost = (post: any) => {
    if (
      !post?.author ||
      !isOwnedByCurrentUser({
        userId: post.author?.id,
        username: post.author?.username,
      })
    ) {
      return post;
    }

    return {
      ...post,
      author: {
        ...post.author,
        username: nextUsername || post.author.username,
        avatar: nextUser.avatar ?? post.author.avatar,
        name: nextUser.name || post.author.name,
      },
    };
  };

  queryClient.setQueryData(postKeys.feed(), (old: any) => {
    if (!old || !Array.isArray(old)) return old;
    return old.map(patchPost);
  });

  queryClient.setQueryData(postKeys.feedInfinite(), (old: any) => {
    if (!old?.pages) return old;
    return {
      ...old,
      pages: old.pages.map((page: any) => ({
        ...page,
        data: page.data?.map(patchPost),
      })),
    };
  });

  queryClient.setQueryData(postKeys.profilePosts(userId), (old: any) => {
    if (!old || !Array.isArray(old)) return old;
    return old.map(patchPost);
  });

  const patchStory = (story: any) => {
    if (
      !isOwnedByCurrentUser({
        userId: story?.userId,
        username: story?.username,
      })
    ) {
      return story;
    }

    const patchItem = (item: any) => ({
      ...item,
      header: item?.header
        ? {
            ...item.header,
            heading: nextUsername || item.header.heading,
            profileImage: nextUser.avatar ?? item.header.profileImage,
          }
        : item?.header,
    });

    return {
      ...story,
      username: nextUsername || story.username,
      avatar: nextUser.avatar ?? story.avatar,
      items: Array.isArray(story?.items)
        ? story.items.map(patchItem)
        : story?.items,
      stories: Array.isArray(story?.stories)
        ? story.stories.map(patchItem)
        : story?.stories,
    };
  };

  queryClient.setQueryData(["stories"], (old: any) => {
    if (!old || !Array.isArray(old)) return old;
    return old.map(patchStory);
  });

  queryClient.setQueryData(["stories", "list"], (old: any) => {
    if (!old || !Array.isArray(old)) return old;
    return old.map(patchStory);
  });
}

/**
 * useMyProfile - Fetches current user's profile with computed counts
 *
 * CRITICAL: This is the canonical source for profile data on my profile screen.
 * Uses query key: ['profile', myUserId]
 * Fetches via: GET /api/users/:id/profile
 */
export function useMyProfile() {
  const authUser = useAuthStore((s) => s.user);
  const userId = authUser?.id;

  return useQuery({
    // CRITICAL: Use empty string fallback to prevent undefined key
    // The enabled flag below ensures we only fetch when userId exists
    queryKey: profileKeys.byId(userId || "__no_user__"),
    queryFn: async (): Promise<ProfileData | null> => {
      if (!userId) {
        console.log("[useMyProfile] No userId, returning null");
        return null;
      }

      console.log("[useMyProfile] Fetching profile for userId:", userId);

      try {
        const profile = await usersApi.getProfileById(userId);
        if (!profile) {
          throw new Error("Profile not found");
        }

        // CRITICAL: Resolve avatar URL properly - it may be string or media object
        const resolvedAvatar =
          resolveAvatarUrl((profile as any).avatarUrl, "useMyProfile") ||
          resolveAvatarUrl(profile.avatar, "useMyProfile");

        // CRITICAL: Always log profile counts for debugging SEV-0
        console.log("[useMyProfile] Profile response:", {
          id: profile.id,
          followersCount: profile.followersCount,
          followingCount: profile.followingCount,
          postsCount: profile.postsCount,
          avatarUrlType: typeof (profile as any).avatarUrl,
          avatarType: typeof profile.avatar,
          resolvedAvatar: resolvedAvatar?.slice(0, 50),
        });

        return {
          id: String(profile.id),
          username: profile.username,
          name: profile.name || profile.username,
          displayName: profile.name || profile.username,
          bio: profile.bio,
          avatar: resolvedAvatar || undefined,
          avatarUrl: resolvedAvatar || undefined,
          website: profile.website || undefined,
          links: Array.isArray((profile as any).links)
            ? (profile as any).links
            : undefined,
          location: profile.location || undefined,
          pronouns: (profile as any).pronouns || undefined,
          gender: (profile as any).gender || undefined,
          followersCount: profile.followersCount || 0,
          followingCount: profile.followingCount || 0,
          postsCount: profile.postsCount || 0,
          verified: false,
          isOwnProfile: true,
        };
      } catch (error) {
        console.error("[useMyProfile] Error fetching profile:", error);
        // Fall back to authUser data if profile endpoint fails
        if (authUser) {
          return {
            id: authUser.id,
            username: authUser.username,
            name: authUser.name,
            bio: authUser.bio,
            avatar: authUser.avatar,
            website: authUser.website,
            links: authUser.links,
            location: authUser.location,
            pronouns: authUser.pronouns,
            gender: authUser.gender,
            hashtags: authUser.hashtags,
            followersCount: authUser.followersCount || 0,
            followingCount: authUser.followingCount || 0,
            postsCount: authUser.postsCount || 0,
            verified: authUser.isVerified,
            isOwnProfile: true,
          };
        }
        return null;
      }
    },
    enabled: !!userId,
    staleTime: STALE_TIMES.profileSelf,
  });
}

/**
 * useUpdateProfile - Mutation to update profile with OPTIMISTIC updates
 *
 * CRITICAL: Updates happen IMMEDIATELY in onMutate, before server responds.
 * On error, we rollback to previous state.
 * Updates BOTH:
 * - ['authUser'] (Zustand store via setUser)
 * - ['profile', myUserId] (React Query cache)
 * - Feed caches (for avatar updates)
 * - Stories cache (for avatar updates)
 */
export function useUpdateProfile() {
  const queryClient = useQueryClient();
  const authUser = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);

  return useMutation({
    mutationFn: async (data: UpdateProfileInput) => {
      console.log("[useUpdateProfile] Updating profile:", data);
      const result = await usersApi.updateProfile(data);
      return result;
    },
    onMutate: async (variables) => {
      const userId = authUser?.id;
      if (!userId || !authUser) return {};

      console.log("[useUpdateProfile] Optimistic update starting");

      const nextUsername = variables.username || authUser.username;

      await Promise.all([
        queryClient.cancelQueries({ queryKey: profileKeys.byId(userId) }),
        authUser.username
          ? queryClient.cancelQueries({
              queryKey: profileKeys.byUsername(authUser.username),
            })
          : Promise.resolve(),
        nextUsername && nextUsername !== authUser.username
          ? queryClient.cancelQueries({
              queryKey: profileKeys.byUsername(nextUsername),
            })
          : Promise.resolve(),
        authUser.username
          ? queryClient.cancelQueries({
              queryKey: ["users", "username", authUser.username],
            })
          : Promise.resolve(),
        nextUsername && nextUsername !== authUser.username
          ? queryClient.cancelQueries({
              queryKey: ["users", "username", nextUsername],
            })
          : Promise.resolve(),
        queryClient.cancelQueries({ queryKey: ["posts"] }),
        queryClient.cancelQueries({ queryKey: ["stories"] }),
      ]);

      const previousAuthUser = { ...authUser };
      const previousProfile = queryClient.getQueryData<ProfileData>(
        profileKeys.byId(userId),
      );
      const previousProfileByUsername = authUser.username
        ? queryClient.getQueryData(profileKeys.byUsername(authUser.username))
        : undefined;
      const previousNextProfileByUsername =
        nextUsername && nextUsername !== authUser.username
          ? queryClient.getQueryData(profileKeys.byUsername(nextUsername))
          : undefined;
      const previousUserByUsername = authUser.username
        ? queryClient.getQueryData(["users", "username", authUser.username])
        : undefined;
      const previousNextUserByUsername =
        nextUsername && nextUsername !== authUser.username
          ? queryClient.getQueryData(["users", "username", nextUsername])
          : undefined;
      const previousFeed = queryClient.getQueryData(["posts", "feed"]);
      const previousInfiniteFeed = queryClient.getQueryData(
        postKeys.feedInfinite(),
      );
      const previousProfilePosts = queryClient.getQueryData(
        postKeys.profilePosts(userId),
      );
      const previousStories = queryClient.getQueryData(["stories"]);
      const previousStoriesList = queryClient.getQueryData(["stories", "list"]);

      const optimisticUser: AppUser = {
        ...authUser,
        username: nextUsername,
        bio: variables.bio ?? authUser.bio,
        website: variables.website ?? authUser.website,
        links: variables.links ?? authUser.links,
        avatar: variables.avatar ?? authUser.avatar,
        location: variables.location ?? authUser.location,
        pronouns: variables.pronouns ?? authUser.pronouns,
        gender: variables.gender ?? authUser.gender,
        hashtags: variables.hashtags ?? authUser.hashtags,
        name: variables.name ?? authUser.name,
      };
      setUser(optimisticUser);
      patchCurrentUserEverywhere(queryClient, authUser, optimisticUser);

      return <UpdateProfileContext>{
        previousAuthUser,
        optimisticUser,
        previousProfile,
        previousProfileByUsername,
        previousNextProfileByUsername,
        previousUserByUsername,
        previousNextUserByUsername,
        previousFeed,
        previousInfiniteFeed,
        previousProfilePosts,
        previousStories,
        previousStoriesList,
        userId,
      };
    },
    onError: (error, variables, context) => {
      console.error("[useUpdateProfile] Error, rolling back:", error);

      if (context?.previousAuthUser) {
        setUser(context.previousAuthUser);
      }
      if (context?.userId) {
        restoreQueryData(
          queryClient,
          profileKeys.byId(context.userId),
          context.previousProfile,
        );
      }
      if (context?.previousAuthUser?.username) {
        restoreQueryData(
          queryClient,
          profileKeys.byUsername(context.previousAuthUser.username),
          context.previousProfileByUsername,
        );
        restoreQueryData(
          queryClient,
          ["users", "username", context.previousAuthUser.username],
          context.previousUserByUsername,
        );
      }
      if (
        variables.username &&
        context?.previousAuthUser?.username &&
        variables.username !== context.previousAuthUser.username
      ) {
        restoreQueryData(
          queryClient,
          profileKeys.byUsername(variables.username),
          context.previousNextProfileByUsername,
        );
        restoreQueryData(
          queryClient,
          ["users", "username", variables.username],
          context.previousNextUserByUsername,
        );
      }
      restoreQueryData(queryClient, postKeys.feed(), context?.previousFeed);
      restoreQueryData(
        queryClient,
        postKeys.feedInfinite(),
        context?.previousInfiniteFeed,
      );
      if (context?.userId) {
        restoreQueryData(
          queryClient,
          postKeys.profilePosts(context.userId),
          context.previousProfilePosts,
        );
      }
      restoreQueryData(queryClient, ["stories"], context?.previousStories);
      restoreQueryData(
        queryClient,
        ["stories", "list"],
        context?.previousStoriesList,
      );
    },
    onSuccess: (result, variables, context) => {
      const baseUser =
        context?.optimisticUser || useAuthStore.getState().user || authUser;
      if (!baseUser) return;

      const finalUser: AppUser = {
        ...baseUser,
        ...result,
        username: result.username || variables.username || baseUser.username,
        name: result.name || variables.name || baseUser.name,
        bio: result.bio ?? variables.bio ?? baseUser.bio,
        website: result.website ?? variables.website ?? baseUser.website,
        links: Array.isArray((result as any)?.links)
          ? (result as any).links
          : (variables.links ?? baseUser.links),
        avatar: result.avatar ?? variables.avatar ?? baseUser.avatar,
        location: result.location ?? variables.location ?? baseUser.location,
        pronouns: result.pronouns ?? variables.pronouns ?? baseUser.pronouns,
        gender: result.gender ?? variables.gender ?? baseUser.gender,
        hashtags: variables.hashtags ?? baseUser.hashtags,
        postsCount: result.postsCount ?? baseUser.postsCount ?? 0,
        followersCount: result.followersCount ?? baseUser.followersCount ?? 0,
        followingCount: result.followingCount ?? baseUser.followingCount ?? 0,
        isVerified: (result as any).isVerified ?? baseUser.isVerified,
      };

      setUser(finalUser);
      patchCurrentUserEverywhere(
        queryClient,
        context?.optimisticUser || baseUser,
        finalUser,
      );

      console.log("[useUpdateProfile] Server confirmed, update complete");

      queryClient.invalidateQueries({ queryKey: ["authUser"] });
      queryClient.invalidateQueries({
        queryKey: profileKeys.byId(finalUser.id),
      });

      if (context?.previousAuthUser?.username) {
        queryClient.invalidateQueries({
          queryKey: profileKeys.byUsername(context.previousAuthUser.username),
        });
        queryClient.invalidateQueries({
          queryKey: ["users", "username", context.previousAuthUser.username],
        });
      }

      if (finalUser.username) {
        queryClient.invalidateQueries({
          queryKey: profileKeys.byUsername(finalUser.username),
        });
        queryClient.invalidateQueries({
          queryKey: ["users", "username", finalUser.username],
        });
      }
    },
  });
}
