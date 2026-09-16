import { create } from "zustand";
import { eventsApi } from "@dvnt/app/lib/api/events";
import {
  ATTENDEE_PAGE_SIZE,
  attendeePageRequest,
  mergeAttendeePage,
  normalizeAttendeeRow,
  type AttendeeRow,
} from "@dvnt/app/lib/events/attendee-page";

/**
 * Paged "Who's going" rows, keyed by event id. Shared by the native accordion
 * and its web port so both platforms scroll to the same end of the same list —
 * the detail payload only ever carries the first 20.
 */
export interface EventAttendeesEntry {
  rows: AttendeeRow[];
  loading: boolean;
  /** Rows returned by the most recent fetch; null before any fetch. */
  lastPageSize: number | null;
}

const EMPTY: EventAttendeesEntry = { rows: [], loading: false, lastPageSize: null };

interface EventAttendeesState {
  byEvent: Record<string, EventAttendeesEntry>;
  /** Fold the detail payload's first screenful in without dropping loaded pages. */
  seed: (eventId: string, raw: unknown[]) => void;
  loadMore: (eventId: string, visibility: unknown) => Promise<void>;
}

export const useEventAttendeesStore = create<EventAttendeesState>((set, get) => ({
  byEvent: {},
  seed: (eventId, raw) => {
    const seeded = raw.map((r, i) => normalizeAttendeeRow(r as never, i));
    const entry = get().byEvent[eventId] ?? EMPTY;
    const rows = mergeAttendeePage(entry.rows, seeded);
    // Re-seeding on every render must not churn state or the list re-mounts.
    if (rows.length === entry.rows.length && entry.rows.length > 0) return;
    set((s) => ({ byEvent: { ...s.byEvent, [eventId]: { ...entry, rows } } }));
  },
  loadMore: async (eventId, visibility) => {
    const entry = get().byEvent[eventId] ?? EMPTY;
    if (entry.loading) return;
    set((s) => ({ byEvent: { ...s.byEvent, [eventId]: { ...entry, loading: true } } }));
    const { limit, offset } = attendeePageRequest(entry.rows.length, ATTENDEE_PAGE_SIZE);
    const page = await eventsApi.getEventAttendeePage(eventId, {
      visibility,
      limit,
      offset,
    });
    const rows = mergeAttendeePage(
      entry.rows,
      page.map((r, i) => normalizeAttendeeRow(r, offset + i)),
    );
    set((s) => ({
      byEvent: {
        ...s.byEvent,
        [eventId]: { rows, loading: false, lastPageSize: page.length },
      },
    }));
  },
}));

export const selectAttendees = (eventId: string) => (s: EventAttendeesState) =>
  s.byEvent[eventId] ?? EMPTY;
