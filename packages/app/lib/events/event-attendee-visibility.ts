/** Shared database, hydrated-model, and editor-draft classification fields. */
export interface AttendanceEventSource {
  event_type?: unknown;
  eventType?: unknown;
  category?: unknown;
  lynk_room_id?: unknown;
  lynkRoomId?: unknown;
  show_attendees?: unknown;
  showAttendees?: unknown;
}

/** Sneaky Lynk is a linked room, not every virtual_session or NSFW event. */
export function isSensitiveAttendanceEvent(event: AttendanceEventSource | null | undefined): boolean {
  if (!event) return false;
  // Explicit canonical null clears a stale normalized/editor alias.
  const canonical = event.event_type !== undefined ? event.event_type : event.eventType;
  const type = typeof canonical === "string" && canonical.length > 0 ? canonical : event.category;
  const room = event.lynk_room_id !== undefined ? event.lynk_room_id : event.lynkRoomId;
  return type === "sex_party" || (typeof room === "string" && room.trim().length > 0);
}

/** Ordinary events retain their existing behavior; protected events opt in. */
export function canShowEventAttendees(event: AttendanceEventSource | null | undefined): boolean {
  if (!event) return false;
  if (!isSensitiveAttendanceEvent(event)) return true;
  const setting = event.show_attendees !== undefined ? event.show_attendees : event.showAttendees;
  return setting === true;
}

/** Strip stale profile previews without changing aggregate attendance counts. */
export function sanitizeEventAttendance<T extends AttendanceEventSource & {
  attendees?: unknown; attendeeAvatars?: unknown; totalAttendees?: unknown; friendsGoing?: unknown; friends_going?: unknown;
}>(event: T): T {
  if (canShowEventAttendees(event)) return event;
  return {
    ...event,
    attendeeAvatars: [],
    ...(event.friendsGoing !== undefined ? { friendsGoing: 0 } : {}),
    ...(event.friends_going !== undefined ? { friends_going: 0 } : {}),
    ...(Array.isArray(event.attendees)
      ? { attendees: typeof event.totalAttendees === "number" ? event.totalAttendees : 0 }
      : {}),
  };
}
