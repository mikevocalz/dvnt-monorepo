/**
 * Boot Prefetch Hook — Instagram-grade instant boot
 *
 * Fires ONCE when the authenticated user enters the protected layout.
 *
 * Strategy:
 * 1. MMKV-persisted query cache is restored BEFORE this runs (via PersistQueryClientProvider)
 * 2. If persisted cache exists → UI already rendered instantly from cache
 * 3. This hook fires background refresh in parallel to update stale data
 * 4. prefetchQuery only fetches if cache is stale — no double-fetching fresh data
 *
 * Cache-first flow:
 *   Cold start WITH cache → tabs render instantly from MMKV → this refreshes in background
 *   Cold start WITHOUT cache → tabs show skeletons → this populates cache → UI appears
 *
 * See: .windsurf/workflows/no-waterfall-rules.md
 */

import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import { postsApi } from "@dvnt/app/lib/api/posts";
import { messagesApi as messagesApiClient } from "@dvnt/app/lib/api/messages-impl";
import { usersApi } from "@dvnt/app/lib/api/users";
import { notificationsApi } from "@dvnt/app/lib/api/notifications";
import { eventsApi as eventsApiClient } from "@dvnt/app/lib/api/events";
import { bookmarksApi } from "@dvnt/app/lib/api/bookmarks";
import { postKeys } from "@dvnt/app/lib/hooks/use-posts";
import { messageKeys } from "@dvnt/app/lib/hooks/use-messages";
import { profileKeys } from "@dvnt/app/lib/hooks/use-profile";
import { notificationKeys } from "@dvnt/app/lib/hooks/use-notifications-query";
import { eventKeys } from "@dvnt/app/lib/hooks/use-events";
import { bookmarkKeys } from "@dvnt/app/lib/hooks/use-bookmarks";
import { activityKeys } from "@dvnt/app/lib/hooks/use-activities-query";
import { storyKeys } from "@dvnt/app/lib/hooks/use-stories";
import { getCurrentUserIdSync } from "@dvnt/app/lib/api/auth-helper";
import { useChatStore } from "@dvnt/app/lib/stores/chat-store";
import { prefetchImages, prefetchImagesRN } from "@dvnt/app/lib/perf/image-prefetch";
import { storiesApi as storiesApiClient } from "@dvnt/app/lib/api/stories";
import { isSafeMode } from "@dvnt/app/lib/boot-guard";
import { useAppStore } from "@dvnt/app/lib/stores/app-store";

/**
 * Check if the persisted cache has enough data for instant render.
 * If it does, we log "cache-first" mode — the user sees zero loading.
 */
function detectCacheStatus(queryClient: any, userId: string): string {
  const hasFeed = !!queryClient.getQueryData(postKeys.feedInfinite());
  const hasProfile = !!queryClient.getQueryData(profileKeys.byId(userId));
  const hasMessages = !!queryClient.getQueryData(
    messageKeys.unreadCount(userId),
  );
  const hasEvents = !!queryClient.getQueryData(eventKeys.list());
  const hasProfilePosts = !!queryClient.getQueryData(
    postKeys.profilePosts(userId),
  );
  const hasActivities = !!queryClient.getQueryData(activityKeys.list(userId));
  const hasStories = !!queryClient.getQueryData(storyKeys.list());

  const hits = [
    hasFeed,
    hasProfile,
    hasMessages,
    hasEvents,
    hasProfilePosts,
    hasActivities,
    hasStories,
  ].filter(Boolean).length;
  if (hits >= 6) return "full";
  if (hits > 0) return "partial";
  return "empty";
}

export function useBootPrefetch() {
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const userId = user?.id;
  const hasPrefetched = useRef(false);

  useEffect(() => {
    if (!userId || hasPrefetched.current) return;
    hasPrefetched.current = true;

    // Safe mode: skip all prefetch to prevent crash loops from bad startup queries
    if (isSafeMode()) {
      console.warn("[BootPrefetch] SAFE MODE — skipping all prefetch lanes");
      return;
    }

    const t0 = Date.now();
    const cacheStatus = detectCacheStatus(queryClient, userId);

    console.log(
      `[BootPrefetch] Cache status: ${cacheStatus} — ` +
        (cacheStatus === "full"
          ? "instant render from MMKV, refreshing in background"
          : cacheStatus === "partial"
            ? "partial cache hit, filling gaps"
            : "first boot, fetching all critical data"),
    );

    // ── PRIORITY LANES ──────────────────────────────────────────────
    // Instead of 13 simultaneous requests (thundering herd), fire in
    // priority lanes so the feed renders ASAP and connection pool
    // isn't saturated on cold start.
    //
    // Lane 0 (immediate):  Feed + My Profile — above the fold
    // Lane 1 (+100ms):     Badge counts — tab bar needs these
    // Lane 2 (+400ms):     Conversations + Activities — adjacent tabs
    // Lane 3 (+1000ms):    Profile posts, bookmarks, events, secondary
    // Lane 4 (+2000ms):    Chat message prefetch for top conversations

    const logLane = (lane: number, results: PromiseSettledResult<any>[]) => {
      const ok = results.filter((r) => r.status === "fulfilled").length;
      const fail = results.filter((r) => r.status === "rejected").length;
      console.log(
        `[BootPrefetch] Lane ${lane}: ${ok} ok, ${fail} failed (${Date.now() - t0}ms)`,
      );
      if (__DEV__) {
        results.forEach((r, i) => {
          if (r.status === "rejected") {
            console.warn(
              `[BootPrefetch] Lane ${lane}[${i}] failed:`,
              (r as PromiseRejectedResult).reason,
            );
          }
        });
      }
    };

    // Lane 0: Critical — feed + profile + stories (above the fold)
    // Read nsfwEnabled non-reactively so boot prefetch matches the live
    // Feed query's filter and doesn't hydrate the cache with SFW posts when
    // the user has spicy ON (which would leak non-spicy rows into the feed
    // after the strict filter was added in posts.ts).
    const nsfwEnabledAtBoot = useAppStore.getState().nsfwEnabled;
    Promise.allSettled([
      queryClient.prefetchInfiniteQuery({
        queryKey: postKeys.feedInfinite(),
        queryFn: ({ pageParam = 0 }: { pageParam: number }) =>
          postsApi.getFeedPostsPaginated(pageParam, nsfwEnabledAtBoot),
        initialPageParam: 0,
      }),
      queryClient.prefetchQuery({
        queryKey: profileKeys.byId(userId),
        queryFn: () => usersApi.getProfileById(userId),
      }),
      queryClient
        .prefetchQuery({
          queryKey: storyKeys.list(),
          queryFn: () => storiesApiClient.getStories(),
        })
        .then(() => {
          // Warm expo-image cache for story thumbnails after data lands
          const stories = queryClient.getQueryData<any[]>(storyKeys.list());
          if (stories?.length) {
            const thumbUrls: string[] = [];
            for (const story of stories) {
              const items = story.items || [];
              const latest = items[items.length - 1];
              const thumb = latest?.thumbnail || latest?.url;
              if (thumb) thumbUrls.push(thumb);
              // Also prefetch the full-size story images for the viewer
              for (const item of items) {
                if (item?.url) thumbUrls.push(item.url);
              }
            }
            if (thumbUrls.length) {
              prefetchImages(thumbUrls);
            }
          }
        }),
    ]).then((r) => logLane(0, r));

    // Lane 1: Badge counts — needed for tab bar badges
    setTimeout(() => {
      Promise.allSettled([
        queryClient.prefetchQuery({
          queryKey: messageKeys.unreadCount(userId),
          queryFn: () => messagesApiClient.getUnreadCounts(),
        }),
        queryClient.prefetchQuery({
          queryKey: notificationKeys.badges(userId),
          queryFn: () => notificationsApi.getBadges(),
        }),
      ]).then((r) => logLane(1, r));
    }, 100);

    // Lane 2: Adjacent tabs — conversations + activities
    setTimeout(() => {
      Promise.allSettled([
        queryClient.prefetchQuery({
          queryKey: messageKeys.conversations(userId),
          queryFn: messagesApiClient.getConversations,
        }),
        queryClient.prefetchQuery({
          queryKey: activityKeys.list(userId),
          queryFn: async () => {
            const { notificationsApiClient: nApi } =
              await import("@dvnt/app/lib/api/notifications");
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
                  ? {
                      id: String(n.post.id || ""),
                      thumbnail: n.post.thumbnail || "",
                    }
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
        }),
        queryClient.prefetchQuery({
          queryKey: [...messageKeys.all(userId), "filtered", "primary"],
          queryFn: () => messagesApiClient.getFilteredConversations("primary"),
        }),
      ]).then((r) => logLane(2, r));
    }, 400);

    // Lane 3: Secondary data — profile posts, bookmarks, events
    setTimeout(() => {
      Promise.allSettled([
        queryClient.prefetchQuery({
          queryKey: postKeys.profilePosts(userId),
          queryFn: () => postsApi.getProfilePosts(userId),
        }),
        queryClient.prefetchQuery({
          queryKey: bookmarkKeys.list(),
          queryFn: () => bookmarksApi.getBookmarks(),
        }),
        queryClient.prefetchQuery({
          queryKey: eventKeys.list(),
          queryFn: () => eventsApiClient.getEvents(20),
        }),
        queryClient.prefetchQuery({
          queryKey: notificationKeys.list(userId),
          queryFn: async () => {
            const response = await notificationsApi.get({ limit: 50 });
            return response.docs || [];
          },
        }),
        queryClient.prefetchQuery({
          queryKey: [...eventKeys.all, "mine"] as const,
          queryFn: () => eventsApiClient.getMyEvents(),
        }),
        (() => {
          const userIdInt = getCurrentUserIdSync();
          if (!userIdInt) return Promise.resolve();
          return queryClient.prefetchQuery({
            queryKey: eventKeys.liked(userIdInt),
            queryFn: () => eventsApiClient.getLikedEvents(userIdInt),
          });
        })(),
      ]).then((r) => logLane(3, r));
    }, 1000);

    // Lane 4: Chat message prefetch for top 3 conversations (lowest priority)
    setTimeout(() => {
      try {
        const conversations = queryClient.getQueryData<any[]>(
          messageKeys.conversations(userId),
        );
        if (conversations && conversations.length > 0) {
          const top3 = conversations.slice(0, 3);
          console.log(
            `[BootPrefetch] Lane 4: Prefetching messages for ${top3.length} top conversations`,
          );
          top3.forEach((conv: any) => {
            if (conv?.id) {
              useChatStore.getState().loadMessages(String(conv.id));
            }
          });
        }
      } catch (err) {
        console.warn("[BootPrefetch] Lane 4 (chat) failed:", err);
      }

      const totalElapsed = Date.now() - t0;
      console.log(
        `[BootPrefetch] All lanes dispatched in ${totalElapsed}ms` +
          (cacheStatus === "full"
            ? " (background refresh)"
            : " (initial load)"),
      );
    }, 2000);
  }, [userId, queryClient]);
}
