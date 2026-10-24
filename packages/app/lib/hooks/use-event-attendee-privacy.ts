import { useEffect } from "react";
import { canShowEventAttendees, type AttendanceEventSource } from "@dvnt/app/lib/events/event-attendee-visibility";
import { useEventAttendeesStore } from "@dvnt/app/lib/stores/event-attendees-store";

/** Purge paged identities even when the entire section is not mounted. */
export function useEventAttendeePrivacy(eventId: string | undefined, event: AttendanceEventSource | null | undefined): boolean {
  const allowed = canShowEventAttendees(event);
  const setAllowed = useEventAttendeesStore((s) => s.setAllowed);
  useEffect(() => {
    if (eventId) setAllowed(eventId, allowed);
  }, [eventId, allowed, setAllowed]);
  return allowed;
}
