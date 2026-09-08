/**
 * React Query hooks for Tickets + Organizer
 *
 * Two rules this file exists to hold:
 *
 * 1. A credential cache is account-scoped. Every "my tickets" key carries the
 *    viewer id (`qk.tickets.*`), so a logout or an account switch cannot hand
 *    the next member the previous one's passes.
 * 2. Tickets are never deduplicated or addressed by `event_id`. One event can
 *    hold an admission ticket, a coat-check claim, and several holders' passes;
 *    each is a separate credential with its own identity.
 */

import {
  useQuery,
  useMutation,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { ticketsApi, TicketsUnavailableError } from "@dvnt/app/lib/api/tickets";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import { qk } from "@dvnt/app/lib/query/keys";
import { STALE_TIMES, GC_TIMES } from "@dvnt/app/lib/perf/stale-time-config";
import {
  classifyTicketRouteParam,
  orderTicketGroup,
  resolveTicketRoute,
  type TicketResolution,
} from "@dvnt/app/lib/tickets/ticket-identity";
import type { TicketRecord } from "@dvnt/app/lib/api/tickets";

/**
 * The account a ticket cache belongs to. `"anon"` keeps a signed-out read from
 * colliding with a real member's cache rather than sharing one bucket.
 */
export function useTicketViewerId(): string {
  return useAuthStore((s) => s.user?.id ?? "anon");
}

/**
 * Legacy alias kept so existing call sites keep compiling. New code should use
 * `qk.tickets` directly — `lib/query/keys.ts` is the single key registry.
 *
 * @deprecated use `qk.tickets`
 */
export const ticketKeys = {
  all: qk.tickets.all,
  myTickets: qk.tickets.mine,
  myTicketsForEvent: qk.tickets.forEvent,
  eventTickets: qk.tickets.roster,
  ticketTypes: qk.tickets.types,
  financials: qk.tickets.financials,
};

/**
 * A failed ticket read is worth retrying a few times before it becomes an
 * error the member sees; the cold-start auth race in particular clears itself.
 */
function retryTicketRead(failureCount: number, error: unknown): boolean {
  if (error instanceof TicketsUnavailableError && error.authRace) {
    return failureCount < 4;
  }
  return failureCount < 2;
}

/** Current user's tickets across all events — always enabled */
export function useMyTickets() {
  const viewerId = useTicketViewerId();

  return useQuery({
    queryKey: qk.tickets.mine(viewerId),
    queryFn: () => ticketsApi.getMyTickets(),
    retry: retryTicketRead,
    staleTime: 0, // Tickets change in real-time (scanned, transferred, refunded)
    gcTime: GC_TIMES.standard,
    // Poll every 5s while screen is active to catch webhook-delayed ticket activation
    refetchInterval: 5000,
    refetchIntervalInBackground: false,
  });
}

/**
 * Every pass this account holds for one event, in a stable display order.
 *
 * Seeded from the already-cached full list so opening a pass from My Tickets
 * paints immediately without a second round trip, and so an event with two
 * passes never briefly renders as one.
 */
export function useMyTicketsForEvent(eventId: string) {
  const viewerId = useTicketViewerId();
  const queryClient = useQueryClient();
  // "My tickets" is an authed-only lookup. On public event pages a logged-out
  // visitor has no account → skip the call (it would 401 "Not authenticated").
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  return useQuery({
    queryKey: qk.tickets.forEvent(viewerId, eventId),
    queryFn: () => ticketsApi.getMyTicketsForEvent(eventId),
    enabled: !!eventId && isAuthenticated,
    retry: retryTicketRead,
    staleTime: 0, // Ticket status changes in real-time
    gcTime: GC_TIMES.standard,
    placeholderData: () => cachedTicketsForEvent(queryClient, viewerId, eventId),
    // Poll every 3s until something arrives (catches issuance webhook delay)
    refetchInterval: (query) =>
      !query.state.data || query.state.data.length === 0 ? 3000 : false,
    refetchIntervalInBackground: false,
  });
}

function cachedTicketsForEvent(
  queryClient: QueryClient,
  viewerId: string,
  eventId: string,
): TicketRecord[] | undefined {
  if (!eventId) return undefined;
  const all = queryClient.getQueryData<TicketRecord[]>(
    qk.tickets.mine(viewerId),
  );
  if (!all) return undefined;
  const forEvent = all.filter(
    (ticket) => String(ticket.event_id) === String(eventId),
  );
  return forEvent.length > 0 ? forEvent : undefined;
}

/**
 * "Does this account hold anything for this event?" — for CTA state on an event
 * page, not for opening a pass.
 *
 * `primary` is a DISPLAY representative (the first pass in the group's stable
 * order), deliberately named so no caller mistakes it for a handle on a
 * specific credential. To open a pass, route by `ticket.id`.
 */
export function useMyTicketStatusForEvent(eventId: string) {
  const query = useMyTicketsForEvent(eventId);
  const group = orderTicketGroup(query.data ?? []);
  return {
    ...query,
    tickets: group,
    hasTicket: group.length > 0,
    primary: group[0],
  };
}

/**
 * Resolve a `/ticket/:id` param to a specific credential.
 *
 * A uuid addresses one ticket. An integer is an event id — a legacy link shape
 * still in the wild (watch actions, calendar entries, older pushes) — and
 * resolves to the event's group, which opens a pass only when the group holds
 * exactly one. See `lib/tickets/ticket-identity.ts`.
 */
export function useTicketRoute(rawParam: unknown): {
  resolution: TicketResolution;
  eventId: string | null;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  isRefetching: boolean;
  refetch: () => void;
} {
  const param = classifyTicketRouteParam(rawParam);
  const viewerId = useTicketViewerId();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  // A ticket id does not name its event, so the whole (account-scoped) library
  // is the lookup table. It is one already-cached, already-polling query — the
  // same one My Tickets and the watch projection read.
  const all = useQuery({
    queryKey: qk.tickets.mine(viewerId),
    queryFn: () => ticketsApi.getMyTickets(),
    enabled: param.kind !== "invalid" && isAuthenticated,
    retry: retryTicketRead,
    staleTime: 0,
    gcTime: GC_TIMES.standard,
    refetchInterval: 5000,
    refetchIntervalInBackground: false,
  });

  const resolution = resolveTicketRoute(param, all.data ?? []);
  const eventId =
    resolution.kind === "ticket"
      ? String(resolution.ticket.event_id)
      : resolution.kind === "group"
        ? String(resolution.group[0].event_id)
        : param.kind === "event"
          ? param.eventId
          : null;

  return {
    resolution,
    eventId,
    isLoading: all.isLoading,
    isError: all.isError,
    error: all.error,
    isRefetching: all.isRefetching,
    refetch: () => {
      all.refetch();
    },
  };
}

/** All tickets for an event (organizer view) */
export function useEventTickets(eventId: string) {
  return useQuery({
    queryKey: qk.tickets.roster(eventId),
    queryFn: () => ticketsApi.getEventTickets(eventId),
    enabled: !!eventId,
    staleTime: STALE_TIMES.events,
    gcTime: GC_TIMES.short,
  });
}

/** Ticket types for an event */
export function useTicketTypes(eventId: string) {
  return useQuery({
    queryKey: qk.tickets.types(eventId),
    queryFn: () => ticketsApi.getTicketTypes(eventId),
    enabled: !!eventId,
    staleTime: STALE_TIMES.events,
    gcTime: GC_TIMES.short,
  });
}

/** Event financials (organizer view) */
export function useEventFinancials(eventId: string) {
  return useQuery({
    queryKey: qk.tickets.financials(eventId),
    queryFn: () => ticketsApi.getEventFinancials(eventId),
    enabled: !!eventId,
    staleTime: STALE_TIMES.events,
    gcTime: GC_TIMES.short,
  });
}

/** Incoming ticket transfers awaiting this account's decision. */
export function usePendingTransfers() {
  const viewerId = useTicketViewerId();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  return useQuery({
    queryKey: qk.tickets.transfers(viewerId),
    queryFn: async () => {
      const { incoming } = await ticketsApi.getPendingTransfers();
      return incoming ?? [];
    },
    enabled: isAuthenticated,
    staleTime: 0,
    gcTime: GC_TIMES.standard,
  });
}

/** Purchase tickets mutation */
export function useCheckoutTicket() {
  const queryClient = useQueryClient();
  const viewerId = useTicketViewerId();

  return useMutation({
    mutationFn: ticketsApi.checkout,
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: qk.tickets.mine(viewerId),
      });
      queryClient.invalidateQueries({
        queryKey: qk.tickets.forEvent(viewerId, variables.eventId),
      });
      queryClient.invalidateQueries({
        queryKey: qk.tickets.roster(variables.eventId),
      });
      queryClient.invalidateQueries({
        queryKey: qk.tickets.types(variables.eventId),
      });
    },
  });
}

/** Scan ticket mutation */
export function useScanTicket() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      qrToken,
      scannedBy,
      eventId: scanEventId,
    }: {
      qrToken: string;
      scannedBy?: string;
      eventId?: string;
    }) => ticketsApi.scanTicket(qrToken, scannedBy, scanEventId),
    onSuccess: (_data, variables) => {
      if (variables.eventId) {
        queryClient.invalidateQueries({
          queryKey: qk.tickets.roster(variables.eventId),
        });
      }
    },
  });
}
