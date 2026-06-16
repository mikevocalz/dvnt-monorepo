/**
 * Notifications Query Hook - TanStack Query
 * Query Key: ['notifications', viewerId]
 */

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { notificationsApi } from "@/lib/api/notifications";
import { useAuthStore } from "@/lib/stores/auth-store";
import { STALE_TIMES, GC_TIMES } from "@/lib/perf/stale-time-config";

export const notificationKeys = {
  all: ["notifications"] as const,
  list: (viewerId: string) => ["notifications", viewerId] as const,
  badges: (viewerId: string) => ["badges", viewerId] as const,
};

export function useNotificationsQuery() {
  const viewerId = useAuthStore((s) => s.user?.id) || "";

  return useQuery({
    queryKey: notificationKeys.list(viewerId),
    queryFn: async () => {
      const response = await notificationsApi.get({ limit: 50 });
      return response.docs || [];
    },
    enabled: !!viewerId,
    staleTime: STALE_TIMES.activities,
  });
}

export function useBadges() {
  const viewerId = useAuthStore((s) => s.user?.id) || "";

  return useQuery({
    queryKey: notificationKeys.badges(viewerId),
    queryFn: () => notificationsApi.getBadges(),
    enabled: !!viewerId,
    staleTime: STALE_TIMES.unreadCounts,
    gcTime: GC_TIMES.short,
    refetchInterval: 60 * 1000,
  });
}
