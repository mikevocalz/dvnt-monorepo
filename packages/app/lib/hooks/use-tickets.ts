/**
 * React Query hooks for Tickets + Organizer
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ticketsApi } from "@dvnt/app/lib/api/tickets";
import { getCurrentUserAuthId } from "@dvnt/app/lib/api/auth-helper";
import { useTicketStore } from "@dvnt/app/lib/stores/ticket-store";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import { STALE_TIMES, GC_TIMES } from "@dvnt/app/lib/perf/stale-time-config";
import type { TicketRecord } from "@dvnt/app/lib/api/tickets";

export const ticketKeys = {
  all: ["tickets"] as const,
  myTickets: () => [...ticketKeys.all, "mine"] as const,
  myTicketForEvent: (eventId: string) =>
    [...ticketKeys.all, "mine", eventId] as const,
  eventTickets: (eventId: string) =>
    [...ticketKeys.all, "event", eventId] as const,
  ticketTypes: (eventId: string) =>
    [...ticketKeys.all, "types", eventId] as const,
  financials: (eventId: string) =>
    [...ticketKeys.all, "financials", eventId] as const,
};

function storeTicketToRecord(
  ticket: ReturnType<typeof useTicketStore.getState>["tickets"][string],
): TicketRecord {
  return {
    id: ticket.id,
    event_id: parseInt(ticket.eventId, 10) || 0,
    ticket_type_id: "",
    user_id: ticket.userId,
    status: (ticket.status === "valid" ? "active" : ticket.status) as
      | "active"
      | "scanned"
      | "refunded"
      | "void"
      | "transfer_pending",
    qr_token: ticket.qrToken,
    checked_in_at: ticket.checkedInAt || null,
    checked_in_by: null,
    purchase_amount_cents: ticket.paid ? null : 0,
    created_at: new Date().toISOString(),
    ticket_type_name: ticket.tierName || "Free Entry",
    event_title: ticket.eventTitle || "",
    event_image: ticket.eventImage || "",
    event_date: ticket.eventDate || "",
    event_location: ticket.eventLocation || "",
  };
}

function findCachedMyTicket(
  queryClient: ReturnType<typeof useQueryClient>,
  eventId: string,
): TicketRecord | undefined {
  if (!eventId) return undefined;

  const direct = queryClient.getQueryData<TicketRecord>(
    ticketKeys.myTicketForEvent(eventId),
  );
  if (direct) return direct;

  const tickets = queryClient.getQueryData<TicketRecord[]>(
    ticketKeys.myTickets(),
  );
  return tickets?.find((ticket) => String(ticket.event_id) === String(eventId));
}

/** Current user's tickets across all events — always enabled */
export function useMyTickets() {
  const zustandTickets = useTicketStore((s) => s.tickets);

  return useQuery({
    queryKey: ticketKeys.myTickets(),
    queryFn: async () => {
      const dbTickets = await ticketsApi.getMyTickets();

      // Merge Zustand store tickets (from RSVP path) that aren't in DB yet
      const dbEventIds = new Set(dbTickets.map((t) => String(t.event_id)));
      const storeOnlyTickets = Object.values(zustandTickets)
        .filter((t) => !dbEventIds.has(String(t.eventId)))
        .map((t) => storeTicketToRecord(t));

      return [...dbTickets, ...storeOnlyTickets];
    },
    staleTime: 0, // Tickets change in real-time (scanned, transferred, refunded)
    gcTime: GC_TIMES.standard,
    // Poll every 5s while screen is active to catch webhook-delayed ticket activation
    refetchInterval: 5000,
    refetchIntervalInBackground: false,
  });
}

/** Current user's ticket for a specific event */
export function useMyTicketForEvent(eventId: string) {
  const queryClient = useQueryClient();
  const storeTicket = useTicketStore((s) => s.getTicketByEventId(eventId));
  const cachedTicket = findCachedMyTicket(queryClient, eventId);
  // "My ticket" is an authed-only lookup. On public event pages a logged-out
  // visitor has no account → skip the call (it would 401 "Not authenticated").
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  return useQuery({
    queryKey: ticketKeys.myTicketForEvent(eventId),
    queryFn: () => ticketsApi.getMyTicketForEvent(eventId),
    enabled: !!eventId && isAuthenticated,
    staleTime: 0, // Ticket status changes in real-time
    gcTime: GC_TIMES.standard,
    // If Zustand store has a ticket (from recent RSVP), use it as placeholder
    placeholderData: storeTicket
      ? storeTicketToRecord(storeTicket)
      : cachedTicket,
    // Poll every 3s until ticket data arrives (catches payment_pending webhook delay)
    refetchInterval: (query) => (!query.state.data ? 3000 : false),
    refetchIntervalInBackground: false,
  });
}

/** All tickets for an event (organizer view) */
export function useEventTickets(eventId: string) {
  return useQuery({
    queryKey: ticketKeys.eventTickets(eventId),
    queryFn: () => ticketsApi.getEventTickets(eventId),
    enabled: !!eventId,
    staleTime: STALE_TIMES.events,
    gcTime: GC_TIMES.short,
  });
}

/** Ticket types for an event */
export function useTicketTypes(eventId: string) {
  return useQuery({
    queryKey: ticketKeys.ticketTypes(eventId),
    queryFn: () => ticketsApi.getTicketTypes(eventId),
    enabled: !!eventId,
    staleTime: STALE_TIMES.events,
    gcTime: GC_TIMES.short,
  });
}

/** Event financials (organizer view) */
export function useEventFinancials(eventId: string) {
  return useQuery({
    queryKey: ticketKeys.financials(eventId),
    queryFn: () => ticketsApi.getEventFinancials(eventId),
    enabled: !!eventId,
    staleTime: STALE_TIMES.events,
    gcTime: GC_TIMES.short,
  });
}

/** Purchase tickets mutation */
export function useCheckoutTicket() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ticketsApi.checkout,
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: ticketKeys.myTickets(),
      });
      queryClient.invalidateQueries({
        queryKey: ticketKeys.eventTickets(variables.eventId),
      });
      queryClient.invalidateQueries({
        queryKey: ticketKeys.ticketTypes(variables.eventId),
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
          queryKey: ticketKeys.eventTickets(variables.eventId),
        });
      }
    },
  });
}
