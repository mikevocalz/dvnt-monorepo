/**
 * Follow/Unfollow Hook with Optimistic Updates
 *
 * Features:
 * - Explicit follow/unfollow action (no toggle race)
 * - Instant UI updates via updateUserRelationshipEverywhere()
 * - Automatic rollback on error
 * - Server-authoritative counts reconciliation
 * - Covers ALL caches: profile, lists, AND activities
 */

import {
  useMutation,
  useQueryClient,
  QueryClient,
} from "@tanstack/react-query";
import { followsApi, type FollowMutationResult } from "@/lib/api/follows";
import { useUIStore } from "@/lib/stores/ui-store";
import { useAuthStore } from "@/lib/stores/auth-store";
import { useActivityStore } from "@/lib/stores/activity-store";
import { activityKeys, type Activity } from "@/lib/hooks/use-activities-query";

interface FollowContext {
  previousUserData: any;
  username: string | null;
  previousViewerData?: any;
  previousAuthUser?: any;
  previousListCaches: Array<{ queryKey: readonly unknown[]; data: any }>;
  previousAuthFallbackCaches: Array<{
    queryKey: readonly unknown[];
    data: any;
  }>;
  previousActivityFollowed?: boolean;
  previousActivities?: Activity[];
}

/**
 * Centralized cache updater: update follow relationship for a user
 * across ALL caches in the app (profile, lists, activities, etc.)
 *
 * This is the single source of truth for follow-state cache updates.
 * Call this from optimistic updates AND from authoritative server reconciliation.
 */
export function updateUserRelationshipEverywhere(
  queryClient: QueryClient,
  targetUserId: string,
  targetUsername: string | undefined,
  newIsFollowing: boolean,
  viewerId?: string,
): Array<{ queryKey: readonly unknown[]; data: any }> {
  const snapshots: Array<{ queryKey: readonly unknown[]; data: any }> = [];

  // ── 1. Update paginated + flat list caches (followers/following/users) ──
  const listPrefixes = ["users", "followers", "following"];
  for (const prefix of listPrefixes) {
    const queries = queryClient.getQueriesData<any>({ queryKey: [prefix] });
    for (const [queryKey, data] of queries) {
      if (!data) continue;
      snapshots.push({ queryKey: [...queryKey], data });

      // Infinite query shape: { pages: [{ users: [...] }] }
      if (data.pages && Array.isArray(data.pages)) {
        queryClient.setQueryData(queryKey, (old: any) => {
          if (!old?.pages) return old;
          return {
            ...old,
            pages: old.pages.map((page: any) => {
              if (!page?.users || !Array.isArray(page.users)) return page;
              return {
                ...page,
                users: page.users.map((u: any) => {
                  if (
                    String(u.id) === String(targetUserId) ||
                    (targetUsername && u.username === targetUsername)
                  ) {
                    return { ...u, isFollowing: newIsFollowing };
                  }
                  return u;
                }),
              };
            }),
          };
        });
      }
      // Flat array shape: [{ id, isFollowing, ... }]
      else if (Array.isArray(data)) {
        queryClient.setQueryData(queryKey, (old: any[]) => {
          if (!Array.isArray(old)) return old;
          return old.map((u: any) => {
            if (
              String(u.id) === String(targetUserId) ||
              (targetUsername && u.username === targetUsername)
            ) {
              return { ...u, isFollowing: newIsFollowing };
            }
            return u;
          });
        });
      }
    }
  }

  // ── 2. CRITICAL: Update activities cache (notifications screen) ──
  // This fixes the core bug where follow buttons on notifications were stale
  if (viewerId && targetUsername) {
    const activitiesKey = activityKeys.list(viewerId);
    const prevActivities = queryClient.getQueryData<Activity[]>(activitiesKey);
    if (prevActivities) {
      snapshots.push({ queryKey: [...activitiesKey], data: prevActivities });
      queryClient.setQueryData<Activity[]>(activitiesKey, (old) => {
        if (!old || !Array.isArray(old)) return old;
        return old.map((activity) => {
          if (activity.user.username === targetUsername) {
            return {
              ...activity,
              user: { ...activity.user, viewerFollows: newIsFollowing },
            };
          }
          return activity;
        });
      });
    }
  }

  // ── 3. Sync activity store's followedUsers set ──
  if (targetUsername) {
    const newFollowedUsers = new Set(useActivityStore.getState().followedUsers);
    if (newIsFollowing) {
      newFollowedUsers.add(targetUsername);
    } else {
      newFollowedUsers.delete(targetUsername);
    }
    useActivityStore.setState({ followedUsers: newFollowedUsers });
  }

  return snapshots;
}

function updateAuthUserFallbackCaches(
  queryClient: QueryClient,
  targetUserId: string,
  targetUsername: string | undefined,
  newIsFollowing: boolean,
  followersCount?: number,
): Array<{ queryKey: readonly unknown[]; data: any }> {
  const snapshots: Array<{ queryKey: readonly unknown[]; data: any }> = [];
  const authQueries = queryClient.getQueriesData<any>({
    queryKey: ["auth-user"],
  });

  for (const [queryKey, data] of authQueries) {
    if (!data || typeof data !== "object") continue;

    const matchesTarget =
      String(data.id || "") === String(targetUserId) ||
      String(data.authId || "") === String(targetUserId) ||
      (!!targetUsername && data.username === targetUsername);

    if (!matchesTarget) continue;

    snapshots.push({ queryKey: [...queryKey], data });
    queryClient.setQueryData(queryKey, (old: any) => {
      if (!old) return old;
      return {
        ...old,
        isFollowing: newIsFollowing,
        ...(typeof followersCount === "number"
          ? { followersCount: followersCount }
          : {}),
      };
    });
  }

  return snapshots;
}

export function useFollow() {
  const queryClient = useQueryClient();
  const showToast = useUIStore((s) => s.showToast);
  const authUser = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  const viewerId = authUser?.id;

  return useMutation({
    mutationFn: async ({
      userId,
      action,
    }: {
      userId: string;
      action: "follow" | "unfollow";
      username?: string;
    }) => {
      return await followsApi.followAction(userId, action);
    },
    // Optimistic update — instant UI feedback across ALL screens
    onMutate: async ({ userId, action, username }) => {
      const newIsFollowing = action === "follow";
      const countDelta = newIsFollowing ? 1 : -1;

      // Cancel relevant queries in PARALLEL to prevent overwrites
      // PERF: Previously 6 sequential awaits blocked the optimistic update.
      const userQueryKey = username
        ? ["users", "username", username]
        : ["users", "id", userId];
      const viewerProfileKey = viewerId ? ["profile", viewerId] : null;
      const cancels: Promise<void>[] = [
        queryClient.cancelQueries({ queryKey: userQueryKey }),
        queryClient.cancelQueries({ queryKey: ["users", "followers"] }),
        queryClient.cancelQueries({ queryKey: ["users", "following"] }),
      ];
      if (userId) {
        cancels.push(
          queryClient.cancelQueries({ queryKey: ["profile", userId] }),
        );
      }
      if (viewerProfileKey) {
        cancels.push(queryClient.cancelQueries({ queryKey: viewerProfileKey }));
      }
      if (viewerId) {
        cancels.push(
          queryClient.cancelQueries({ queryKey: activityKeys.list(viewerId) }),
        );
      }
      await Promise.all(cancels);

      // Snapshot previous state for rollback
      const previousUserData = queryClient.getQueryData(userQueryKey);
      const previousViewerData = viewerProfileKey
        ? queryClient.getQueryData(viewerProfileKey)
        : undefined;
      const previousAuthUser = authUser;
      const previousActivityFollowed = username
        ? useActivityStore.getState().followedUsers.has(username)
        : undefined;
      const previousActivities = viewerId
        ? queryClient.getQueryData<Activity[]>(activityKeys.list(viewerId))
        : undefined;

      // 1. Update target user's profile cache
      if (previousUserData) {
        queryClient.setQueryData(userQueryKey, (old: any) => {
          if (!old) return old;
          return {
            ...old,
            isFollowing: newIsFollowing,
            followersCount: Math.max(0, (old.followersCount || 0) + countDelta),
          };
        });
      }

      // 2. Update viewer's profile cache (following count)
      if (viewerProfileKey && previousViewerData) {
        queryClient.setQueryData(viewerProfileKey, (old: any) => {
          if (!old) return old;
          return {
            ...old,
            followingCount: Math.max(0, (old.followingCount || 0) + countDelta),
          };
        });
      }

      // 3. Update auth store (following count)
      if (authUser) {
        setUser({
          ...authUser,
          followingCount: Math.max(
            0,
            (authUser.followingCount || 0) + countDelta,
          ),
        });
      }

      // 4. CENTRALIZED: Update ALL list + activities caches
      const previousListCaches = updateUserRelationshipEverywhere(
        queryClient,
        userId,
        username,
        newIsFollowing,
        viewerId,
      );
      const previousAuthFallbackCaches = updateAuthUserFallbackCaches(
        queryClient,
        userId,
        username,
        newIsFollowing,
      );

      return {
        previousUserData,
        username: username || null,
        previousViewerData,
        previousAuthUser,
        previousListCaches,
        previousAuthFallbackCaches,
        previousActivityFollowed,
        previousActivities,
      } as FollowContext;
    },
    onError: (error: any, variables, context) => {
      // Rollback on error
      let targetKey: readonly unknown[] | null = null;
      if (variables.username) {
        targetKey = ["users", "username", variables.username];
      } else if (variables.userId) {
        targetKey = ["users", "id", variables.userId];
      }
      if (context?.previousUserData && targetKey) {
        queryClient.setQueryData(targetKey, context.previousUserData);
      }

      if (viewerId && context?.previousViewerData) {
        queryClient.setQueryData(
          ["profile", viewerId],
          context.previousViewerData,
        );
      }

      if (context?.previousAuthUser) {
        setUser(context.previousAuthUser);
      }

      // Rollback list caches (includes activities)
      if (context?.previousListCaches) {
        for (const { queryKey, data } of context.previousListCaches) {
          queryClient.setQueryData(queryKey, data);
        }
      }
      if (context?.previousAuthFallbackCaches) {
        for (const { queryKey, data } of context.previousAuthFallbackCaches) {
          queryClient.setQueryData(queryKey, data);
        }
      }

      // Rollback activity store
      if (
        variables.username &&
        typeof context?.previousActivityFollowed === "boolean"
      ) {
        const newFollowedUsers = new Set(
          useActivityStore.getState().followedUsers,
        );
        if (context.previousActivityFollowed) {
          newFollowedUsers.add(variables.username);
        } else {
          newFollowedUsers.delete(variables.username);
        }
        useActivityStore.setState({ followedUsers: newFollowedUsers });
      }

      const errorMessage =
        error?.message ||
        error?.error?.message ||
        "Check your connection and try again.";
      showToast("error", "Follow failed", errorMessage);
    },
    onSuccess: (data: FollowMutationResult, variables) => {
      // CRITICAL: Use server-authoritative counts to reconcile cache
      console.log("[useFollow] Server response:", {
        following: data.following,
        targetFollowersCount: data.targetFollowersCount,
        callerFollowingCount: data.callerFollowingCount,
        correlationId: data.correlationId,
        targetUserId: variables.userId,
        viewerId,
      });

      // Reconcile target user's profile with server-confirmed counts
      const targetQueryKey = variables.username
        ? ["users", "username", variables.username]
        : ["users", "id", variables.userId];

      queryClient.setQueryData(targetQueryKey, (old: any) => {
        if (!old) return old;
        return {
          ...old,
          isFollowing: data.following,
          followersCount: data.targetFollowersCount,
        };
      });

      if (variables.userId) {
        queryClient.setQueryData(["profile", variables.userId], (old: any) => {
          if (!old) return old;
          return {
            ...old,
            isFollowing: data.following,
            followersCount: data.targetFollowersCount,
          };
        });
      }

      updateAuthUserFallbackCaches(
        queryClient,
        variables.userId,
        variables.username,
        data.following,
        data.targetFollowersCount,
      );

      // Reconcile viewer's following count with server-confirmed count
      if (viewerId) {
        queryClient.setQueryData(["profile", viewerId], (old: any) => {
          if (!old) return old;
          return { ...old, followingCount: data.callerFollowingCount };
        });

        if (authUser) {
          setUser({ ...authUser, followingCount: data.callerFollowingCount });
        }
      }

      // Show success toast
      showToast(
        "success",
        data.following ? "Following" : "Unfollowed",
        data.following
          ? `You are now following ${data.targetUsername || "this user"}`
          : `You unfollowed ${data.targetUsername || "this user"}`,
      );
    },
    onSettled: (_data, _error, variables) => {
      // Targeted invalidation — NOT broad storms
      const invalidations: Promise<unknown>[] = [];

      if (variables.username) {
        invalidations.push(
          queryClient.invalidateQueries({
            queryKey: ["users", "username", variables.username],
          }),
        );
      }
      if (variables.userId) {
        invalidations.push(
          queryClient.invalidateQueries({
            queryKey: ["profile", variables.userId],
          }),
        );
      }
      if (variables.username) {
        invalidations.push(
          queryClient.invalidateQueries({
            queryKey: ["auth-user"],
          }),
        );
      }

      if (viewerId) {
        invalidations.push(
          queryClient.invalidateQueries({ queryKey: ["authUser"] }),
          queryClient.invalidateQueries({ queryKey: ["profile", viewerId] }),
        );
      }

      // Followers/following lists
      invalidations.push(
        queryClient.invalidateQueries({ queryKey: ["users", "followers"] }),
        queryClient.invalidateQueries({ queryKey: ["users", "following"] }),
      );

      Promise.all(invalidations).then(() => {
        console.log("[useFollow] Targeted caches invalidated for sync");
      });
    },
  });
}
