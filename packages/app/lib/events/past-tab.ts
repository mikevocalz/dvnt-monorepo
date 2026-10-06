/**
 * The Past Events tab list, shared rule for native and web.
 *
 * Input is getPastEvents (ended public events, newest first). Native used to
 * build this tab by filtering the home RPC, which only returns events that
 * ended in the last 24 hours, so it showed at most a day of history while web
 * showed the full list.
 */

import { eventEnded } from "./event-time.ts";

export interface PastTabEvent {
  title?: string | null;
  fullDate?: string | null;
  endDate?: string | null;
  location?: string | null;
  host?: { username?: string | null } | null;
}

export function pastTabEvents<T extends PastTabEvent>(
  events: readonly T[] | null | undefined,
  search = "",
  now: number = Date.now(),
): T[] {
  const q = search.trim().toLowerCase();
  return (events ?? []).filter((event) => {
    if (!event.title || !event.fullDate || !eventEnded(event, now)) return false;
    if (!q) return true;
    return `${event.title} ${event.location ?? ""} ${event.host?.username ?? ""}`
      .toLowerCase()
      .includes(q);
  });
}
