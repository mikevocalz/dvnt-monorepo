/**
 * Attendee paging for the event-detail "Who's going" accordion.
 *
 * `get_event_attendee_avatars` hard-caps at `limit 20`
 * (apps/mobile/supabase/migrations/20260916121000_private_event_access_boundary.sql:228),
 * so the accordion could only ever render 20 faces while the header counted the
 * real total — event 79 has 90 active attendees and showed 20. A scroll
 * container over that would have looked fixed without being fixed, so the list
 * pages through `get_event_attendee_page` instead.
 *
 * Pure module: no React, no Supabase, no react-native. Node-testable.
 */

export const ATTENDEE_PAGE_SIZE = 24;

export interface AttendeeRow {
  id: string;
  username: string;
  avatar: string;
  initials: string;
  color: string;
}

/**
 * The RPC has shipped the photo URL under `avatar`, `image`, and `url`
 * depending on version, and an id-less row used to collapse to "" — two of
 * those made React see duplicate keys and reuse the wrong row's state. Fall
 * through id -> username -> position so the key is unique either way.
 */
export function normalizeAttendeeRow(
  raw: Record<string, unknown> | null | undefined,
  index: number,
): AttendeeRow {
  const r = (raw ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : String(v));
  const username = str(r.username);
  return {
    id: str(r.id) || username || `attendee-${index}`,
    username,
    avatar: str(r.avatar) || str(r.image) || str(r.url),
    initials: str(r.initials),
    color: "#3b82f6",
  };
}

/** Limit/offset for the next page, given what is already on screen. */
export function attendeePageRequest(
  loaded: number,
  pageSize: number = ATTENDEE_PAGE_SIZE,
): { limit: number; offset: number } {
  return { limit: pageSize, offset: Math.max(0, Math.trunc(loaded)) };
}

/**
 * Is there more to load?
 *
 * A short page wins over any count: `events.total_attendees` is a denormalised
 * counter that drifts above the rows the guest-list query can return (refunded
 * tickets, deleted users), so trusting it would leave a "Load more" that never
 * loads. Before the first page, the seed's size is compared against the count.
 */
export function hasMoreAttendees(state: {
  loaded: number;
  totalCount?: number | null;
  /** Row count of the last page fetched; null/undefined before any fetch. */
  lastPageSize?: number | null;
  pageSize?: number;
}): boolean {
  const pageSize = state.pageSize ?? ATTENDEE_PAGE_SIZE;
  if (state.lastPageSize != null && state.lastPageSize < pageSize) return false;
  const total =
    typeof state.totalCount === "number" && Number.isFinite(state.totalCount)
      ? state.totalCount
      : null;
  if (total != null) return state.loaded < total;
  // No count to compare against: only a full page implies another one behind it.
  return state.loaded > 0 && state.loaded % pageSize === 0;
}

/** Append a page, dropping ids already held. Order is stable: existing first. */
export function mergeAttendeePage(
  existing: readonly AttendeeRow[],
  incoming: readonly AttendeeRow[],
): AttendeeRow[] {
  const seen = new Set(existing.map((a) => a.id));
  const merged = existing.slice();
  for (const row of incoming) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    merged.push(row);
  }
  return merged;
}
