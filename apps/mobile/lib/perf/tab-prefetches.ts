/**
 * Tab Prefetch Registrations
 *
 * Registers prefetch functions for each tab route so the prefetch router
 * can warm the cache when the user taps a tab.
 *
 * Import this module in the (tabs) layout to register all prefetches.
 */

import { registerPrefetch } from "@/lib/perf/prefetch-router";
import { postKeys } from "@/lib/hooks/use-posts";
import { messageKeys } from "@/lib/hooks/use-messages";
import { eventKeys } from "@/lib/hooks/use-events";
import { activityKeys } from "@/lib/hooks/use-activities-query";
import { profileKeys } from "@/lib/hooks/use-profile";
import { bookmarkKeys } from "@/lib/hooks/use-bookmarks";
import { postsApi } from "@/lib/api/posts";
import { messagesApi as messagesApiClient } from "@/lib/api/messages-impl";
import { eventsApi as eventsApiClient } from "@/lib/api/events";
import { usersApi } from "@/lib/api/users";
import { STALE_TIMES } from "@/lib/perf/stale-time-config";
import { useAppStore } from "@/lib/stores/app-store";

// ── Feed Tab ──────────────────────────────────────────────────────────
registerPrefetch("index", (qc, userId) => {
  // Pass nsfwEnabled so tab-prefetch uses the same strict filter as the
  // live Feed query. Without this, tapping the Home tab would overwrite the
  // infinite-feed cache with SFW rows even when spicy is ON.
  const nsfwEnabled = useAppStore.getState().nsfwEnabled;
  qc.prefetchInfiniteQuery({
    queryKey: postKeys.feedInfinite(),
    queryFn: ({ pageParam = 0 }: { pageParam: number }) =>
      postsApi.getFeedPostsPaginated(pageParam, nsfwEnabled),
    initialPageParam: 0,
    staleTime: STALE_TIMES.feed,
  });
});

// ── Events Tab ────────────────────────────────────────────────────────
registerPrefetch("events", (qc, userId) => {
  qc.prefetchQuery({
    queryKey: eventKeys.list(),
    queryFn: () => eventsApiClient.getEvents(20),
    staleTime: STALE_TIMES.events,
  });
});

// ── Activity Tab ──────────────────────────────────────────────────────
registerPrefetch("activity", (qc, userId) => {
  const { notificationsApiClient: nApi } = require("@/lib/api/notifications");
  qc.prefetchQuery({
    queryKey: activityKeys.list(userId),
    queryFn: async () => {
      const result = await nApi.getNotifications(50);
      return (result.docs || [])
        .map((n: any) => ({
          id: String(n.id),
          type: n.type || "like",
          user: {
            id: n.sender?.id || "",
            username: n.sender?.username || "user",
            avatar: n.sender?.avatar || "",
          },
          entityType: n.entityType,
          entityId: n.entityId,
          post: n.post
            ? { id: String(n.post.id || ""), thumbnail: n.post.thumbnail || "" }
            : undefined,
          event: n.event
            ? { id: String(n.event.id || ""), title: n.event.title }
            : undefined,
          comment: n.content,
          timeAgo: "",
          isRead: !!n.readAt,
          createdAt: n.createdAt || new Date().toISOString(),
        }))
        .filter((a: any) => a.id);
    },
    staleTime: STALE_TIMES.activities,
  });
  qc.prefetchQuery({
    queryKey: activityKeys.liked(userId),
    queryFn: async () => {
      const result = await nApi.getLikedActivity(50);
      return (result.docs || []).map((item: any) => ({
        id: String(item.id),
        entityType: item.entityType,
        entityId: String(item.entityId || ""),
        actor: {
          id: item.actor?.id || "",
          username: item.actor?.username || "user",
          avatar: item.actor?.avatar || "",
        },
        title: item.title || "",
        previewImage: item.previewImage || "",
        timeAgo: nApi.formatTimeAgo(item.createdAt || new Date().toISOString()),
        createdAt: item.createdAt || new Date().toISOString(),
      }));
    },
    staleTime: STALE_TIMES.activities,
  });
});

// ── Profile Tab ───────────────────────────────────────────────────────
registerPrefetch("profile", (qc, userId) => {
  qc.prefetchQuery({
    queryKey: profileKeys.byId(userId),
    queryFn: () => usersApi.getProfileById(userId),
    staleTime: STALE_TIMES.profileSelf,
  });
  qc.prefetchQuery({
    queryKey: postKeys.profilePosts(userId),
    queryFn: () => postsApi.getProfilePosts(userId),
    staleTime: STALE_TIMES.profilePosts,
  });
});

// ── Badges (used by tab bar) ──────────────────────────────────────────
registerPrefetch("badges", (qc, userId) => {
  qc.prefetchQuery({
    queryKey: messageKeys.unreadCount(userId),
    queryFn: () => messagesApiClient.getUnreadCounts(),
    staleTime: STALE_TIMES.unreadCounts,
  });
});

// ── Conversations (messages screen) ───────────────────────────────────
registerPrefetch("conversations", (qc, userId) => {
  qc.prefetchQuery({
    queryKey: messageKeys.conversations(userId),
    queryFn: messagesApiClient.getConversations,
    staleTime: STALE_TIMES.conversations,
  });
});
