/**
 * Host view of an event Lynk's waiting room: who is waiting, and Start.
 *
 * Polls event-lynk-room "list" every EVENT_LYNK_WAIT_POLL_MS while the room is
 * active. Terminal rooms stop polling. Start is confirmed by the server,
 * never optimistically presented as live before admission succeeds.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { eventLynkApi } from "@dvnt/app/lib/api/event-lynk";
import { EVENT_LYNK_WAIT_POLL_MS } from "@dvnt/app/lib/events/event-lynk";

import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";

export const eventLynkHostKey = (eventId: number, viewerId: string) => ["event-lynk-host", viewerId, eventId] as const;

export function useEventLynkHost(eventId: number, enabled: boolean) {
  const queryClient = useQueryClient();
  const viewerId = useAuthStore((s) => s.user?.id ?? "anon");
  const authenticated = useAuthStore((s) => s.isAuthenticated);
  const active = enabled && authenticated && Number.isInteger(eventId) && eventId > 0;
  const key = eventLynkHostKey(eventId, String(viewerId));

  const query = useQuery({
    queryKey: key,
    queryFn: () => eventLynkApi.list(eventId),
    enabled: active,
    refetchInterval: (q) =>
      q.state.data?.state === "ended" || q.state.data?.state === "cancelled" ? false : EVENT_LYNK_WAIT_POLL_MS,
    refetchIntervalInBackground: false,
    retry: 1,
  });

  const start = useMutation({
    mutationFn: () => eventLynkApi.start(eventId),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: key });
    },
  });

  return {
    view: active && !query.isError ? query.data ?? null : null,
    isLoading: query.isLoading,
    isError: query.isError,
    isLive: active && query.data?.state === "live",
    isTerminal: active && (query.data?.state === "ended" || query.data?.state === "cancelled"),
    refetch: query.refetch,
    start: start.mutateAsync,
    isStarting: start.isPending,
  };
}
