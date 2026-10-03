/**
 * Host view of an event Lynk's waiting room: who is waiting, and Start.
 *
 * Polls event-lynk-room "list" every EVENT_LYNK_WAIT_POLL_MS while the room is
 * not live (the same polling approach useRoomCapacityWatcher and the ticket
 * hooks use; the waiting table is service-role only, so there is no realtime
 * channel a client could subscribe to). Start is optimistic: the panel flips
 * to live at once and rolls back if the server refuses.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { eventLynkApi, type EventLynkHostView } from "@dvnt/app/lib/api/event-lynk";
import { EVENT_LYNK_WAIT_POLL_MS } from "@dvnt/app/lib/events/event-lynk";

export const eventLynkHostKey = (eventId: number) => ["event-lynk-host", eventId] as const;

export function useEventLynkHost(eventId: number, enabled: boolean) {
  const queryClient = useQueryClient();
  const key = eventLynkHostKey(eventId);

  const query = useQuery({
    queryKey: key,
    queryFn: () => eventLynkApi.list(eventId),
    enabled: enabled && Number.isInteger(eventId) && eventId > 0,
    refetchInterval: (q) =>
      q.state.data?.state === "live" ? false : EVENT_LYNK_WAIT_POLL_MS,
    refetchIntervalInBackground: false,
    retry: 1,
  });

  const start = useMutation({
    mutationFn: () => eventLynkApi.start(eventId),
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<EventLynkHostView>(key);
      queryClient.setQueryData<EventLynkHostView>(key, (old) =>
        old ? { ...old, state: "live", count: 0, waiting: [] } : old,
      );
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(key, ctx.previous);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: key });
    },
  });

  return {
    view: query.data ?? null,
    isLoading: query.isLoading,
    isError: query.isError,
    isLive: query.data?.state === "live",
    start: start.mutateAsync,
    isStarting: start.isPending,
  };
}
