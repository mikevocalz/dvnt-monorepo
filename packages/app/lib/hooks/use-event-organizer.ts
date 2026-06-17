/**
 * useEventOrganizer — fetches the "Hosted by" organizer card for an event.
 *
 * Thin React Query wrapper over get_event_organizer. Cached per-event; the
 * follow CTA in <OrganizerCard> reconciles its own optimistic state via
 * useFollow, so this query stays cheap and rarely refetches.
 */
import { useQuery } from "@tanstack/react-query";
import { eventOrganizerApi } from "@dvnt/app/lib/api/event-organizer";

export const eventOrganizerKeys = {
  detail: (eventId: string) => ["event-organizer", eventId] as const,
};

export function useEventOrganizer(eventId: string | undefined) {
  return useQuery({
    queryKey: eventOrganizerKeys.detail(eventId ?? ""),
    queryFn: () => eventOrganizerApi.getEventOrganizer(eventId!),
    enabled: !!eventId,
    staleTime: 5 * 60 * 1000, // organizer stats move slowly
  });
}
