import { Platform } from "react-native";
import { SafeCalendar as Calendar } from "@/lib/safe-native-modules";
import { mmkv } from "@/lib/mmkv-zustand";
import type { MixedTicket } from "@/lib/contracts/dto";

const CART_CALENDAR_EVENTS_KEY = "@dvnt/cart_calendar_events";
const DEFAULT_EVENT_DURATION_MS = 3 * 60 * 60 * 1000;

interface CalendarRecord {
  id: string;
  allowsModifications?: boolean;
  source?: { name?: string };
  isPrimary?: boolean;
}

export interface AddCartTicketToCalendarResult {
  success: boolean;
  alreadyAdded?: boolean;
  error?:
    | "calendar_not_available"
    | "permission_denied"
    | "no_calendar"
    | "missing_event_date"
    | "unknown";
}

function getAddedEvents(): Record<string, string> {
  try {
    const raw = mmkv.getString(CART_CALENDAR_EVENTS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function markEventAdded(ticketId: string, calendarEventId: string): void {
  const events = getAddedEvents();
  events[ticketId] = calendarEventId;
  mmkv.set(CART_CALENDAR_EVENTS_KEY, JSON.stringify(events));
}

function isAlreadyAdded(ticketId: string): boolean {
  return Boolean(getAddedEvents()[ticketId]);
}

async function getDefaultCalendarId(): Promise<string | null> {
  const calendars = await Calendar.getCalendarsAsync(
    Calendar.EntityTypes?.EVENT,
  );

  const preferred = calendars.find(
    (calendar: CalendarRecord) =>
      calendar.allowsModifications &&
      (calendar.source?.name === "iCloud" ||
        calendar.source?.name === "Default" ||
        calendar.isPrimary),
  );
  if (preferred) return preferred.id;

  const writable = calendars.find(
    (calendar: CalendarRecord) => calendar.allowsModifications,
  );
  if (writable) return writable.id;

  if (Platform.OS === "android" && Calendar.createCalendarAsync) {
    return Calendar.createCalendarAsync({
      title: "DVNT Events",
      color: "#8A40CF",
      entityType: Calendar.EntityTypes.EVENT,
      source: {
        isLocalAccount: true,
        name: "DVNT",
        type: Calendar.SourceType?.LOCAL ?? "LOCAL",
      },
      name: "dvnt-events",
      ownerAccount: "dvnt",
      accessLevel: Calendar.CalendarAccessLevel.OWNER,
    });
  }

  return null;
}

function calendarWindow(
  ticket: MixedTicket,
): { startDate: Date; endDate: Date } | null {
  const startDate = ticket.event_date ? new Date(ticket.event_date) : null;
  if (!startDate || !Number.isFinite(startDate.getTime())) return null;

  const parsedEnd = ticket.event_end_date
    ? new Date(ticket.event_end_date)
    : null;
  const endDate =
    parsedEnd &&
    Number.isFinite(parsedEnd.getTime()) &&
    parsedEnd.getTime() > startDate.getTime()
      ? parsedEnd
      : new Date(startDate.getTime() + DEFAULT_EVENT_DURATION_MS);

  return { startDate, endDate };
}

export async function addCartTicketToCalendar(
  ticket: MixedTicket,
): Promise<AddCartTicketToCalendarResult> {
  try {
    if (
      !Calendar?.requestCalendarPermissionsAsync ||
      !Calendar?.getCalendarsAsync ||
      !Calendar?.createEventAsync
    ) {
      return { success: false, error: "calendar_not_available" };
    }

    if (isAlreadyAdded(ticket.id)) {
      return { success: true, alreadyAdded: true };
    }

    const window = calendarWindow(ticket);
    if (!window) return { success: false, error: "missing_event_date" };

    const { status } = await Calendar.requestCalendarPermissionsAsync();
    if (status !== "granted") {
      return { success: false, error: "permission_denied" };
    }

    const calendarId = await getDefaultCalendarId();
    if (!calendarId) return { success: false, error: "no_calendar" };

    const calendarEventId = await Calendar.createEventAsync(calendarId, {
      title: ticket.event_title || "DVNT Event",
      startDate: window.startDate,
      endDate: window.endDate,
      location: ticket.event_location || undefined,
      notes: [
        ticket.ticket_type_name || "Admission",
        `Ticket ID: ${ticket.id}`,
        "",
        `View ticket: dvnt://ticket/${ticket.event_id}`,
      ].join("\n"),
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      alarms: [{ relativeOffset: -60 }],
    });

    markEventAdded(ticket.id, calendarEventId);
    return { success: true };
  } catch (error) {
    console.error("[addCartTicketToCalendar] Error:", error);
    return { success: false, error: "unknown" };
  }
}
