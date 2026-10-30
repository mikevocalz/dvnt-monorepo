/**
 * Bootstrap Notifications Hook
 *
 * When `perf_bootstrap_notifications` flag is ON, fetches all activity
 * above-the-fold data in a single request and hydrates the TanStack Query cache.
 *
 * Seeds only absent activity data; canonical unread counts load independently.
 */

import { useEffect, useLayoutEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import { isFeatureEnabled } from "@dvnt/app/lib/feature-flags";
import {
  bootstrapApi,
  type BootstrapNotificationsResponse,
} from "@dvnt/app/lib/api/bootstrap";
import { activityKeys } from "@dvnt/app/lib/hooks/use-activities-query";
import { useActivityStore } from "@dvnt/app/lib/stores/activity-store";
import { useScreenTrace } from "@dvnt/app/lib/perf/screen-trace";

function hydrateFromNotificationsBootstrap(
  queryClient: ReturnType<typeof useQueryClient>,
  userId: string,
  data: BootstrapNotificationsResponse,
) {
  // A late bootstrap must not replace fetched history, read-state, or even an
  // authoritative empty result. Follow state belongs to that same snapshot.
  if (queryClient.getQueryData(activityKeys.list(userId)) !== undefined) return false;

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

  // Badge data has an independent canonical query; never seed a partial shape.

  // 2. Seed follow state in activity store — NOW USING USERNAMES (not IDs)
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
  return true;
}

export function useBootstrapNotifications() {
  const queryClient = useQueryClient();
  const userId = useAuthStore((s) => s.user?.id) || "";
  const seedRef = useRef({ userId, sync: false, async: false });
  if (seedRef.current.userId !== userId) {
    seedRef.current = { userId, sync: false, async: false };
  }
  const seed = seedRef.current;
  const trace = useScreenTrace("Activity");

  const enabled = isFeatureEnabled("perf_bootstrap_notifications");

  // ── SYNCHRONOUS: Seed follow state from query cache BEFORE first paint ──
  // useLayoutEffect runs after render but before paint, so the Zustand store is
  // populated before the user sees stale data. Avoids the React warning:
  // "Cannot update a component while rendering a different component".
  useLayoutEffect(() => {
    if (seed.sync || !enabled || !userId || useAuthStore.getState().user?.id !== userId) return;

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
        seed.sync = true;
        trace.markCacheHit();
        trace.markUsable();
      }
    }
  }, [enabled, userId, queryClient, trace, seed]);

  // ── ASYNC: Fetch from server if sync seeding didn't run (stale/missing cache) ──
  useEffect(() => {
    if (!enabled || !userId || seed.async || seed.sync) return;
    seed.async = true;
    let cancelled = false;
    let settled = false;

    bootstrapApi.notifications({ userId }).then((data) => {
      if (!data || cancelled || useAuthStore.getState().user?.id !== userId) return;
      if (hydrateFromNotificationsBootstrap(queryClient, userId, data)) trace.markUsable();
    }).catch(() => {
      // Optional bootstrap failure must not clear independently fetched data.
    }).finally(() => { settled = true; });
    return () => {
      cancelled = true;
      // StrictMode/remount may cancel the first request before it can seed.
      if (!settled) seed.async = false;
    };
  }, [enabled, userId, queryClient, trace, seed]);

  return { enabled };
}
