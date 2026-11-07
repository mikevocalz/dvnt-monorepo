/**
 * Host view of an event Lynk's waiting room: who is waiting, and Start.
 *
 * Polls event-lynk-room "list" every EVENT_LYNK_WAIT_POLL_MS while the room is
 * active. Terminal rooms stop polling. Start is confirmed by the server,
 * never optimistically presented as live before admission succeeds.
 */
import { useSyncExternalStore } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { eventLynkApi } from "@dvnt/app/lib/api/event-lynk";
import { EVENT_LYNK_WAIT_POLL_MS } from "@dvnt/app/lib/events/event-lynk";

import { getSessionLifecycle, subscribeSessionLifecycle } from "@dvnt/app/lib/auth/session-lifecycle";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";

export const eventLynkHostKey = (eventId: number, viewerId: string) => ["event-lynk-host", viewerId, eventId] as const;

export function useEventLynkHost(eventId: number, enabled: boolean) {
  const queryClient = useQueryClient();
  const viewerId = useAuthStore((s) => s.user?.id ?? "anon");
  const authenticated = useAuthStore((s) => s.isAuthenticated);
  const session = useSyncExternalStore(subscribeSessionLifecycle, getSessionLifecycle, getSessionLifecycle);
  const epoch = session.epoch;
  const active = enabled && authenticated && session.ready && Number.isSafeInteger(eventId) && eventId > 0;
  // A same-account sign-in is a new privacy boundary, not a reusable roster.
  const key = [...eventLynkHostKey(eventId, String(viewerId)), epoch] as const;
  const isCurrent = () => {
    const auth = useAuthStore.getState();
    const latest = getSessionLifecycle();
    return active && auth.isAuthenticated && String(auth.user?.id ?? "anon") === String(viewerId) &&
      latest.ready && latest.epoch === epoch;
  };
  const assertCurrent = () => {
    if (!isCurrent()) throw new Error("Your session changed. Refresh the event and try again.");
  };

  const query = useQuery({
    queryKey: key,
    queryFn: async ({ signal }) => {
      assertCurrent();
      const result = await eventLynkApi.list(eventId);
      // Consuming the signal lets React Query cancel obsolete observers. The
      // epoch check also rejects responses arriving before React has rerendered.
      if (signal.aborted) throw new Error("Waiting room request cancelled");
      assertCurrent();
      return result;
    },
    enabled: active,
    refetchInterval: (q) =>
      q.state.data?.state === "ended" || q.state.data?.state === "cancelled" ? false : EVENT_LYNK_WAIT_POLL_MS,
    refetchIntervalInBackground: false,
    retry: 1,
  });

  const start = useMutation({
    mutationFn: (expectedRoomId: string) => {
      assertCurrent();
      return eventLynkApi.start(eventId, expectedRoomId);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: key });
    },
  });

  return {
    view: isCurrent() && !query.isError ? query.data ?? null : null,
    isLoading: query.isLoading,
    isError: query.isError,
    isLive: isCurrent() && query.data?.state === "live",
    isTerminal: isCurrent() && (query.data?.state === "ended" || query.data?.state === "cancelled"),
    refetch: query.refetch,
    start: start.mutateAsync,
    isStarting: start.isPending,
  };
}
