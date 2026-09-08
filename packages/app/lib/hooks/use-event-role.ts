/**
 * This account's server-resolved role on one event.
 *
 * Asks `get-event-tickets` for a single row purely to read the `role` it
 * returns. That endpoint runs the real ladder — owner, then an accepted
 * `admin` / `editor` / `scanner` co-organizer row, 403 otherwise
 * (`functions/get-event-tickets/index.ts:176-195`) — so it is the one place a
 * client can learn a role it did not already know from owning the event.
 *
 * `get-event-staff` cannot serve this: it is owner/admin-only (`:82-88`), so
 * the very role that was locked out could not call it either.
 */

import { useQuery } from "@tanstack/react-query";
import { ticketsApi } from "@dvnt/app/lib/api/tickets";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import { GC_TIMES } from "@dvnt/app/lib/perf/stale-time-config";
import type { EventRole } from "@dvnt/app/lib/events/event-role";

export function useEventRole(eventId: string) {
  const viewerId = useAuthStore((s) => s.user?.id ?? "anon");
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  const query = useQuery({
    queryKey: ["event-role", viewerId, eventId] as const,
    queryFn: async (): Promise<EventRole> => {
      const page = await ticketsApi.getEventTicketsPaginated(eventId, {
        pageSize: 1,
      });
      return (page.role ?? null) as EventRole;
    },
    enabled: !!eventId && isAuthenticated,
    // A role changes when someone is added or removed from staff, which is
    // rare and never mid-shift. Long enough that a door scanner is not
    // re-asking between scans.
    staleTime: 5 * 60 * 1000,
    gcTime: GC_TIMES.standard,
    retry: 1,
  });

  return {
    role: (query.data ?? null) as EventRole,
    /**
     * True until we have an answer. A gate must not refuse during this — that
     * would flash "Not authorized" at legitimate staff on every cold open.
     */
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: query.refetch,
  };
}
