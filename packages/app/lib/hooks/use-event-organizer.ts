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
  coOrganizers: (eventId: string) => ["event-co-organizers", eventId] as const,
};

export function useEventOrganizer(eventId: string | undefined) {
  return useQuery({
    queryKey: eventOrganizerKeys.detail(eventId ?? ""),
    queryFn: () => eventOrganizerApi.getEventOrganizer(eventId!),
    enabled: !!eventId,
    staleTime: 5 * 60 * 1000, // organizer stats move slowly
  });
}

/**
 * Co-hosts billed alongside the host. Separate query from the organizer card so
 * a slow or failing co-host read never delays "Hosted by" — co-hosts are
 * additive, and the card is complete without them.
 */
export function useEventCoOrganizers(eventId: string | undefined) {
  return useQuery({
    queryKey: eventOrganizerKeys.coOrganizers(eventId ?? ""),
    queryFn: () => eventOrganizerApi.getEventCoOrganizers(eventId!),
    enabled: !!eventId,
    staleTime: 5 * 60 * 1000, // billing changes about as often as the card
  });
}
