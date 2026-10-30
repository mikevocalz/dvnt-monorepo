import { readViewerScoped } from "@dvnt/app/lib/query/viewer-scoped-read";
/**
 * Notifications Query Hook - TanStack Query
 * Query Key: ['notifications', viewerId]
 */

import { useQuery } from "@tanstack/react-query";
import { notificationsApi } from "@dvnt/app/lib/api/notifications";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import { STALE_TIMES, GC_TIMES } from "@dvnt/app/lib/perf/stale-time-config";

import { notificationKeys } from "@dvnt/app/lib/notifications/query-keys";
import { useUnreadRealtime } from "@dvnt/app/lib/hooks/use-unread-realtime";
export { notificationKeys };

export function useNotificationsQuery() {
  const viewerId = useAuthStore((s) => s.user?.id) || "";

  return useQuery({
    queryKey: notificationKeys.list(viewerId),
    queryFn: ({ signal }) => readViewerScoped(viewerId, async () => {
      const response = await notificationsApi.get({ limit: 50 });
      return response.docs || [];
    }, signal),
    enabled: !!viewerId,
    staleTime: STALE_TIMES.activities,
  });
}

export function useBadges() {
  const viewerId = useAuthStore((s) => s.user?.id) || "";
  useUnreadRealtime(viewerId, "activity");

  return useQuery({
    queryKey: notificationKeys.badges(viewerId),
    queryFn: ({ signal }) => readViewerScoped(viewerId, () => notificationsApi.getBadges(), signal),
    enabled: !!viewerId,
    staleTime: STALE_TIMES.unreadCounts,
    gcTime: GC_TIMES.short,
    refetchOnMount: "always",
    refetchOnWindowFocus: "always",
    refetchOnReconnect: "always",
    // Fallback for missing realtime publication/dropped events. Never poll hidden tabs.
    refetchInterval: 30 * 1000,
    refetchIntervalInBackground: false,
  });
}
