import { getSessionLifecycle, subscribeSessionLifecycle } from "@dvnt/app/lib/auth/session-lifecycle";
import { canShowEventAttendees, type AttendanceEventSource } from "@dvnt/app/lib/events/event-attendee-visibility";
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
  allowed: Record<string, boolean>;
  revisions: Record<string, number>;
  /** Revoking visibility drops rows and invalidates already-requested pages. */
  setAllowed: (eventId: string, allowed: boolean) => void;
  /** Fold the detail payload's first screenful in without dropping loaded pages. */
  seed: (eventId: string, raw: unknown[], event: AttendanceEventSource) => void;
  loadMore: (eventId: string, visibility: unknown, event: AttendanceEventSource) => Promise<void>;
}

export const useEventAttendeesStore = create<EventAttendeesState>((set, get) => ({
  byEvent: {},
  allowed: {},
  revisions: {},
  setAllowed: (eventId, allowed) => {
    if (get().allowed[eventId] === allowed) return;
    set((s) => ({
      allowed: { ...s.allowed, [eventId]: allowed },
      revisions: { ...s.revisions, [eventId]: (s.revisions[eventId] ?? 0) + 1 },
      ...(!allowed ? { byEvent: { ...s.byEvent, [eventId]: EMPTY } } : {}),
    }));
  },
  seed: (eventId, raw, event) => {
    if (!getSessionLifecycle().ready) return;
    const allowed = canShowEventAttendees(event);
    get().setAllowed(eventId, allowed);
    if (!allowed) return;
    const entry = get().byEvent[eventId] ?? EMPTY;
    // The detail response is authoritative: an empty roster can mean this
    // viewer lost their ticket/RSVP access. Never keep old pages behind it.
    if (raw.length === 0) {
      if (entry.rows.length === 0 && !entry.loading && entry.lastPageSize === 0) return;
      set((s) => ({
        byEvent: { ...s.byEvent, [eventId]: { rows: [], loading: false, lastPageSize: 0 } },
        revisions: { ...s.revisions, [eventId]: (s.revisions[eventId] ?? 0) + 1 },
      }));
      return;
    }
    const seeded = raw.map((r, i) => normalizeAttendeeRow(r as never, i));
    const rows = mergeAttendeePage(entry.rows, seeded);
    // Re-seeding on every render must not churn state or the list re-mounts.
    if (rows.length === entry.rows.length && entry.rows.length > 0) return;
    set((s) => ({ byEvent: { ...s.byEvent, [eventId]: { ...entry, rows } } }));
  },
  loadMore: async (eventId, visibility, event) => {
    const session = getSessionLifecycle();
    if (!session.ready) return;
    if (!canShowEventAttendees(event) || get().allowed[eventId] === false) return;
    const entry = get().byEvent[eventId] ?? EMPTY;
    if (entry.loading) return;
    const revision = get().revisions[eventId] ?? 0;
    set((s) => ({ byEvent: { ...s.byEvent, [eventId]: { ...entry, loading: true } } }));
    const { limit, offset } = attendeePageRequest(entry.rows.length, ATTENDEE_PAGE_SIZE);
    try {
      const page = await eventsApi.getEventAttendeePage(eventId, { visibility, limit, offset });
      // A response started before opt-out must never repopulate hidden profiles,
      // even if the organizer opts in again while that response is in flight.
      if (getSessionLifecycle().epoch !== session.epoch || !getSessionLifecycle().ready ||
        (get().revisions[eventId] ?? 0) !== revision || get().allowed[eventId] === false) return;
      const rows = mergeAttendeePage(entry.rows, page.map((r, i) => normalizeAttendeeRow(r, offset + i)));
      set((s) => ({ byEvent: { ...s.byEvent, [eventId]: { rows, loading: false, lastPageSize: page.length } } }));
    } catch {
      if (getSessionLifecycle().epoch !== session.epoch || !getSessionLifecycle().ready ||
        (get().revisions[eventId] ?? 0) !== revision) return;
      set((s) => ({ byEvent: { ...s.byEvent, [eventId]: { ...entry, loading: false, lastPageSize: 0 } } }));
    }
  },
}));

// In-memory rows are account-scoped just like the query cache. Clearing is
// synchronous, so sign-out/account-switch cannot display the previous roster.
subscribeSessionLifecycle(() => {
  useEventAttendeesStore.setState({ byEvent: {}, allowed: {}, revisions: {} });
});

export const selectAttendees = (eventId: string) => (s: EventAttendeesState) =>
  s.byEvent[eventId] ?? EMPTY;
