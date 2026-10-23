/** Organizer-only setting. It does not override the event's access rules. */
export interface EventAttendanceFieldProps {
  eventType?: string | null;
  lynkRoomId?: string | null;
  showAttendees: boolean | null;
  onChange: (value: boolean) => void;
}

export const EVENT_ATTENDANCE_LABEL = "Who’s Going";
export const EVENT_ATTENDANCE_HELP =
  "Off by default for Sex Party and Sneaky Lynk events. Turn on to show attendee profiles to eligible viewers who can access this event.";
