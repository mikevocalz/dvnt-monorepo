/**
 * addTicketToCalendar — Add event to device calendar via expo-calendar
 * Handles permissions, duplicate detection, and graceful fallbacks.
 */

import { SafeCalendar as Calendar } from "@/lib/safe-native-modules";
import { Platform, Alert, Linking } from "react-native";
import { mmkv } from "@/lib/mmkv-zustand";
import type { Ticket } from "@/lib/stores/ticket-store";

const CALENDAR_EVENTS_KEY = "@deviant/calendar_events";
const DEFAULT_EVENT_DURATION_MS = 3 * 60 * 60 * 1000;

/** Persist which tickets have been added to calendar */
function getAddedEvents(): Record<string, string> {
  try {
    const raw = mmkv.getString(CALENDAR_EVENTS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function markEventAdded(ticketId: string, calendarEventId: string) {
  const map = getAddedEvents();
  map[ticketId] = calendarEventId;
  mmkv.set(CALENDAR_EVENTS_KEY, JSON.stringify(map));
}

function isAlreadyAdded(ticketId: string): boolean {
  const map = getAddedEvents();
  return Boolean(map[ticketId]);
}

/** Get the default writable calendar */
async function getDefaultCalendarId(): Promise<string | null> {
  const calendars = await Calendar.getCalendarsAsync(
    Calendar.EntityTypes?.EVENT,
  );

  type CalendarRecord = { id: string; allowsModifications?: boolean; source?: { name?: string }; isPrimary?: boolean };
  const defaultCal = calendars.find(
    (c: CalendarRecord) =>
      c.allowsModifications &&
      (c.source?.name === "Default" ||
        c.source?.name === "iCloud" ||
        c.isPrimary),
  );

  if (defaultCal) return defaultCal.id;

  const writable = calendars.find((c: CalendarRecord) => c.allowsModifications);
  if (writable) return writable.id;

  // Android: create a local calendar
  if (Platform.OS === "android") {
    const newCalId = await Calendar.createCalendarAsync({
      title: "Deviant Events",
      color: "#fbbf24",
      entityType: Calendar.EntityTypes.EVENT,
      source: {
        isLocalAccount: true,
        name: "Deviant",
        type: Calendar.SourceType?.LOCAL ?? ("LOCAL" as any),
      },
      name: "deviant-events",
      ownerAccount: "deviant",
      accessLevel: Calendar.CalendarAccessLevel.OWNER,
    });
    return newCalId;
  }

  return null;
}

function openSettings() {
  Alert.alert(
    "Calendar Access Required",
    "Please enable calendar access in Settings to add this event.",
    [
      { text: "Cancel", style: "cancel" },
      {
        text: "Open Settings",
        onPress: () => {
          void Linking.openSettings().catch(() => {});
        },
      },
    ],
  );
}

function buildCalendarWindow(startValue?: string | null, endValue?: string | null) {
  const fallbackStart = new Date();
  const parsedStart = startValue ? new Date(startValue) : fallbackStart;
  const startDate = Number.isFinite(parsedStart.getTime())
    ? parsedStart
    : fallbackStart;
  const parsedEnd = endValue ? new Date(endValue) : null;
  const endDate =
    parsedEnd &&
    Number.isFinite(parsedEnd.getTime()) &&
    parsedEnd.getTime() > startDate.getTime()
      ? parsedEnd
      : new Date(startDate.getTime() + DEFAULT_EVENT_DURATION_MS);

  return { startDate, endDate };
}

export interface AddToCalendarResult {
  success: boolean;
  alreadyAdded?: boolean;
  error?: string;
}

/**
 * Add a ticket's event to the device calendar.
 * Returns { success, alreadyAdded, error }.
 */
export async function addTicketToCalendar(
  ticket: Ticket,
): Promise<AddToCalendarResult> {
  try {
    // 0. Guard: Calendar module may not be in this native binary
    if (
      !Calendar?.requestCalendarPermissionsAsync ||
      !Calendar?.getCalendarsAsync ||
      !Calendar?.createEventAsync
    ) {
      return { success: false, error: "calendar_not_available" };
    }

    // 1. Check duplicate
    if (isAlreadyAdded(ticket.id)) {
      return { success: true, alreadyAdded: true };
    }

    // 2. Request permissions
    const { status } = await Calendar.requestCalendarPermissionsAsync();
    if (status !== "granted") {
      openSettings();
      return { success: false, error: "permission_denied" };
    }

    // 3. Get calendar
    const calendarId = await getDefaultCalendarId();
    if (!calendarId) {
      return { success: false, error: "no_calendar" };
    }

    // 4. Build event
    const { startDate, endDate } = buildCalendarWindow(
      ticket.eventDate,
      ticket.eventEndDate,
    );

    const deepLink = `dvnt://ticket/${ticket.eventId}`;

    const notes = [
      ticket.tierName || ticket.tier?.toUpperCase() || "General Admission",
      `Ticket ID: ${ticket.id}`,
      "",
      `View ticket: ${deepLink}`,
    ]
      .filter(Boolean)
      .join("\n");

    const calendarEventId = await Calendar.createEventAsync(calendarId, {
      title: ticket.eventTitle || "Event",
      startDate,
      endDate,
      location: ticket.eventLocation || undefined,
      notes,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      alarms: [{ relativeOffset: -60 }], // 1 hour before
    });

    // 5. Persist
    markEventAdded(ticket.id, calendarEventId);

    return { success: true };
  } catch (err: any) {
    console.error("[addTicketToCalendar] Error:", err);
    return { success: false, error: err?.message || "unknown" };
  }
}
