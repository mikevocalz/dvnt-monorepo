/**
 * App Resume Refresh Hook
 *
 * Silently refreshes badge counts and critical data when the app
 * returns from background. Throttled to prevent rapid-fire refetches.
 *
 * CRITICAL: Updates must be invisible — no loading spinners, no badge flicker.
 * Data flows through TanStack Query cache → components re-render atomically.
 */

import { useEffect, useRef } from "react";
import { AppState, type AppStateStatus } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import { useAuthStore } from "@/lib/stores/auth-store";
import { postKeys } from "@/lib/hooks/use-posts";
import { messageKeys } from "@/lib/hooks/use-messages";
import { profileKeys } from "@/lib/hooks/use-profile";
import { notificationKeys } from "@/lib/hooks/use-notifications-query";
import { eventKeys } from "@/lib/hooks/use-events";
import { activityKeys } from "@/lib/hooks/use-activities-query";
import { storyKeys } from "@/lib/hooks/use-stories";
import { messagesApi as messagesApiClient } from "@/lib/api/messages-impl";
import { notificationsApi } from "@/lib/api/notifications";
import { usersApi } from "@/lib/api/users";
import { storiesApi as storiesApiClient } from "@/lib/api/stories";
import { useAppStore } from "@/lib/stores/app-store";

const THROTTLE_MS = 30_000; // At most once per 30 seconds

export function useAppResume() {
  const queryClient = useQueryClient();
  const userId = useAuthStore((s) => s.user?.id);
  const lastRefreshRef = useRef(0);
  const appStateRef = useRef(AppState.currentState);

  useEffect(() => {
    if (!userId) return;

    const handleAppStateChange = (nextState: AppStateStatus) => {
      const wasBackground =
        appStateRef.current === "background" ||
        appStateRef.current === "inactive";
      const isNowActive = nextState === "active";
      appStateRef.current = nextState;

      if (!wasBackground || !isNowActive) return;

      // Throttle: skip if we refreshed recently
      const now = Date.now();
      if (now - lastRefreshRef.current < THROTTLE_MS) {
        console.log("[AppResume] Throttled — skipping refresh");
        return;
      }
      lastRefreshRef.current = now;

      console.log("[AppResume] App resumed — refreshing critical data");
      useAppStore.getState().loadNsfwSetting("app_resume");

      // Silent background refresh — no loading states, no UI flicker
      // TanStack Query handles the cache update → components re-render once
      Promise.allSettled([
        // Refresh badge counts (most important for perceived freshness)
        queryClient.prefetchQuery({
          queryKey: messageKeys.unreadCount(userId),
          queryFn: () => messagesApiClient.getUnreadCounts(),
        }),

        // Refresh notification badges
        queryClient.prefetchQuery({
          queryKey: notificationKeys.badges(userId),
          queryFn: () => notificationsApi.getBadges(),
        }),

        // Refresh my profile (follower counts may have changed)
        queryClient.prefetchQuery({
          queryKey: profileKeys.byId(userId),
          queryFn: () => usersApi.getProfileById(userId),
        }),

        // Invalidate feed so next scroll triggers background refetch
        queryClient.invalidateQueries({
          queryKey: postKeys.feedInfinite(),
          refetchType: "none", // Don't refetch now — just mark stale
        }),

        // Mark events stale so events tab refreshes on next visit
        queryClient.invalidateQueries({
          queryKey: eventKeys.all,
          refetchType: "none",
        }),

        // Mark profile posts stale
        queryClient.invalidateQueries({
          queryKey: postKeys.profilePosts(userId),
          refetchType: "none",
        }),

        // Actively refetch activities — notifications are time-sensitive
        queryClient.invalidateQueries({
          queryKey: activityKeys.list(userId),
          refetchType: "active", // refetch if any observer is mounted
        }),

        // Mark raw notifications stale
        queryClient.invalidateQueries({
          queryKey: notificationKeys.all,
          refetchType: "none",
        }),

        // Actively refetch stories — above-the-fold, must be fresh on resume
        queryClient.prefetchQuery({
          queryKey: storyKeys.list(),
          queryFn: () => storiesApiClient.getStories(),
        }),
      ]).then((results) => {
        const failed = results.filter((r) => r.status === "rejected").length;
        if (failed > 0) {
          console.warn(`[AppResume] ${failed} refresh(es) failed`);
        } else {
          console.log("[AppResume] All refreshes completed");
        }
      });
    };

    const subscription = AppState.addEventListener(
      "change",
      handleAppStateChange,
    );

    return () => {
      subscription.remove();
    };
  }, [userId, queryClient]);
}
