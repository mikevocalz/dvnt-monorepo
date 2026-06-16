/**
 * Event Waitlist Hooks
 *
 * - useEventWaitlistStatus(eventId, ticketTypeId) — polls whether the
 *   current user is on the waitlist for that tier.
 * - useJoinWaitlist() / useLeaveWaitlist() — mutations with optimistic
 *   status flip + rollback on error.
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { eventWaitlistApi, type WaitlistStatus } from "@/lib/api/event-waitlist";
import { useAuthStore } from "@/lib/stores/auth-store";

export const waitlistKeys = {
  all: ["event-waitlist"] as const,
  status: (eventId: string | number, tierId: string | null) =>
    [
      ...waitlistKeys.all,
      "status",
      String(eventId),
      tierId ? String(tierId) : "__any__",
    ] as const,
};

export function useEventWaitlistStatus(
  eventId: string | number | null | undefined,
  ticketTypeId: string | null = null,
) {
  const user = useAuthStore((s) => s.user);
  const enabled = !!user?.id && !!eventId;
  return useQuery({
    queryKey: waitlistKeys.status(eventId ?? "", ticketTypeId),
    queryFn: () =>
      eventWaitlistApi.getStatus({
        eventId: eventId as string | number,
        ticketTypeId,
      }),
    enabled,
    staleTime: 30 * 1000,
  });
}

export function useJoinWaitlist() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      eventId,
      ticketTypeId,
    }: {
      eventId: string | number;
      ticketTypeId: string | null;
    }) => eventWaitlistApi.join({ eventId, ticketTypeId }),
    onMutate: async ({ eventId, ticketTypeId }) => {
      const key = waitlistKeys.status(eventId, ticketTypeId);
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<WaitlistStatus>(key);
      queryClient.setQueryData<WaitlistStatus>(key, {
        joined: true,
        id: previous?.id ?? null,
        createdAt: previous?.createdAt ?? new Date().toISOString(),
      });
      return { previous, key };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous && ctx?.key) {
        queryClient.setQueryData(ctx.key, ctx.previous);
      }
    },
    onSettled: (_data, _err, vars) => {
      queryClient.invalidateQueries({
        queryKey: waitlistKeys.status(vars.eventId, vars.ticketTypeId),
      });
    },
  });
}

export function useLeaveWaitlist() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      eventId,
      ticketTypeId,
    }: {
      eventId: string | number;
      ticketTypeId: string | null;
    }) => eventWaitlistApi.leave({ eventId, ticketTypeId }),
    onMutate: async ({ eventId, ticketTypeId }) => {
      const key = waitlistKeys.status(eventId, ticketTypeId);
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<WaitlistStatus>(key);
      queryClient.setQueryData<WaitlistStatus>(key, {
        joined: false,
        id: null,
        createdAt: null,
      });
      return { previous, key };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous && ctx?.key) {
        queryClient.setQueryData(ctx.key, ctx.previous);
      }
    },
    onSettled: (_data, _err, vars) => {
      queryClient.invalidateQueries({
        queryKey: waitlistKeys.status(vars.eventId, vars.ticketTypeId),
      });
    },
  });
}
