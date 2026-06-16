/**
 * Bootstrap Notifications Hook
 *
 * When `perf_bootstrap_notifications` flag is ON, fetches all activity
 * above-the-fold data in a single request and hydrates the TanStack Query cache.
 *
 * Eliminates: useActivitiesQuery + fetchFollowingState + getBadges waterfall.
 */

import { useEffect, useLayoutEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuthStore } from "@/lib/stores/auth-store";
import { isFeatureEnabled } from "@/lib/feature-flags";
import {
  bootstrapApi,
  type BootstrapNotificationsResponse,
} from "@/lib/api/bootstrap";
import { activityKeys } from "@/lib/hooks/use-activities-query";
import { notificationKeys } from "@/lib/hooks/use-notifications-query";
import { useActivityStore } from "@/lib/stores/activity-store";
import { useScreenTrace } from "@/lib/perf/screen-trace";

function hydrateFromNotificationsBootstrap(
  queryClient: ReturnType<typeof useQueryClient>,
  userId: string,
  data: BootstrapNotificationsResponse,
) {
  // viewerFollowing is now keyed by USERNAME (fixed server-side)
  const viewerFollowingByUsername = data.viewerFollowing || {};

  // 1. Seed the activities query cache — embed viewerFollows directly
  const activities = data.activities.map((a) => {
    const username = a.actor.username;
    // Use actor.viewerFollows (embedded by server) or fall back to username map
    const viewerFollows =
      a.actor.viewerFollows ?? !!viewerFollowingByUsername[username];

    return {
      id: a.id,
      type: a.type || "like",
      user: {
        id: a.actor.id,
        username,
        avatar: a.actor.avatarUrl,
        viewerFollows,
      },
      entityType: a.entityType,
      entityId: a.entityId,
      post: a.post
        ? { id: a.post.id, thumbnail: a.post.thumbnailUrl }
        : undefined,
      comment: a.commentText,
      postId: a.postId,
      commentId: a.commentId,
      timeAgo: "",
      isRead: a.isRead,
      createdAt: a.createdAt,
    };
  });

  queryClient.setQueryData(activityKeys.list(userId), activities);

  // 2. Seed badge count
  queryClient.setQueryData(notificationKeys.badges(userId), {
    unreadCount: data.unreadCount,
  });

  // 3. Seed follow state in activity store — NOW USING USERNAMES (not IDs)
  const followedSet = new Set(
    Object.entries(viewerFollowingByUsername)
      .filter(([, isFollowing]) => isFollowing)
      .map(([username]) => username),
  );
  useActivityStore.setState({ followedUsers: followedSet });

  console.log(
    `[BootstrapNotifications] Hydrated cache: ${activities.length} activities, ` +
      `${data.unreadCount} unread, ${followedSet.size} followed (by username)`,
  );
}

export function useBootstrapNotifications() {
  const queryClient = useQueryClient();
  const userId = useAuthStore((s) => s.user?.id) || "";
  const hasSyncSeeded = useRef(false);
  const hasAsyncRun = useRef(false);
  const trace = useScreenTrace("Activity");

  const enabled = isFeatureEnabled("perf_bootstrap_notifications");

  // ── SYNCHRONOUS: Seed follow state from query cache BEFORE first paint ──
  // useLayoutEffect runs after render but before paint, so the Zustand store is
  // populated before the user sees stale data. Avoids the React warning:
  // "Cannot update a component while rendering a different component".
  useLayoutEffect(() => {
    if (hasSyncSeeded.current || !enabled || !userId) return;

    const existingActivities = queryClient.getQueryData(
      activityKeys.list(userId),
    ) as any[] | undefined;

    if (Array.isArray(existingActivities) && existingActivities.length > 0) {
      const hasAuthoritativeFollowState = existingActivities
        .filter((a) => a.type === "follow")
        .some((a) => typeof a.user?.viewerFollows === "boolean");

      if (hasAuthoritativeFollowState) {
        const followedSet = new Set<string>();
        for (const a of existingActivities) {
          if (a.user?.viewerFollows === true && a.user?.username) {
            followedSet.add(a.user.username);
          }
        }
        useActivityStore.setState({ followedUsers: followedSet });
        hasSyncSeeded.current = true;
        trace.markCacheHit();
        trace.markUsable();
      }
    }
  }, [enabled, userId, queryClient, trace]);

  // ── ASYNC: Fetch from server if sync seeding didn't run (stale/missing cache) ──
  useEffect(() => {
    if (!enabled || !userId || hasAsyncRun.current) return;
    hasAsyncRun.current = true;

    // Skip server fetch if already seeded synchronously from cache
    if (hasSyncSeeded.current) return;

    // Stale or missing — fetch fresh from server
    bootstrapApi.notifications({ userId }).then((data) => {
      if (!data) return;
      hydrateFromNotificationsBootstrap(queryClient, userId, data);
      trace.markUsable();
    });
  }, [enabled, userId, queryClient, trace]);

  return { enabled };
}
