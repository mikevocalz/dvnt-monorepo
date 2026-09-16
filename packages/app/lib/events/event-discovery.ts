/**
 * One gate for "may this event be discovered?" — lists, search, the feed,
 * public slug resolution and link unfurls all ask here.
 *
 * A cancelled event kept showing up because every surface re-decided this on
 * its own (or not at all): `/events/dc-dick-strict` resolved a title-derived
 * slug over an unfiltered event list and picked the cancelled row over the
 * live one with the same title.
 *
 * Discovery only. A cancelled event stays reachable by direct ownership —
 * its own detail screen by id, the ticket/QR/wallet view, host dashboards,
 * refunds and payouts — none of which route through here.
 */

import { slugify } from "../slug.ts";

/** Statuses that must never be offered to someone who wasn't already holding a link to the row. */
const HIDDEN_STATUSES = new Set(["cancelled", "canceled", "deleted", "draft", "suspended"]);

export type DiscoveryEvent = {
  id?: number | string | null;
  title?: string | null;
  status?: string | null;
  created_at?: string | null;
};

/**
 * Status gate only — visibility (`private`/`link_only`) is a separate axis and
 * stays with whoever owns that decision (RLS for lists, `isShareableEvent` for
 * unfurls). A NULL status is the legacy default and reads as active.
 */
export function isDiscoverableEvent(event: DiscoveryEvent | null | undefined): boolean {
  if (!event) return false;
  const status = typeof event.status === "string" ? event.status.toLowerCase() : "";
  return !HIDDEN_STATUSES.has(status);
}

/** Drop non-discoverable rows from a list. */
export function filterDiscoverableEvents<T extends DiscoveryEvent>(rows: T[] | null | undefined): T[] {
  return (rows ?? []).filter(isDiscoverableEvent);
}

/**
 * Resolve a title-derived slug to one event. Events have no populated slug
 * column (`share_slug` is NULL on every production row), so two events with
 * the same title collide on the same URL.
 *
 * Non-discoverable rows are dropped first — that alone fixes the reported bug,
 * where a cancelled event and a live one shared `dc-dick-strict`. When two
 * still collide, the most recently created one wins: re-running a night is how
 * hosts repeat an event, so the newest row is the one the link means.
 *
 * ponytail: created_at, then id, is the whole tie-breaker. The real fix is a
 * unique slug column populated at create time; nothing populates share_slug
 * today, so the ceiling here is "two same-title live events, and the older one
 * is unreachable by slug" — it is still reachable by id.
 */
export function resolveEventBySlug<T extends DiscoveryEvent>(
  rows: T[] | null | undefined,
  slug: string,
): T | undefined {
  if (!slug) return undefined;
  const matches = filterDiscoverableEvents(rows).filter((r) => slugify(r.title) === slug);
  if (matches.length < 2) return matches[0];
  // created_at only when every candidate carries it — some callers select
  // {id,title,status} only. Ids are monotonic, so a larger id is the newer row.
  const dated = matches.every((r) => Number.isFinite(Date.parse(r.created_at ?? "")));
  const key = (r: T) => (dated ? Date.parse(r.created_at ?? "") : Number(r.id) || 0);
  return matches.reduce((best, row) => (key(row) > key(best) ? row : best));
}

/**
 * True when a slug matches events but the discovery gate hides all of them.
 *
 * Lets the detail screen say "this event was cancelled" instead of "Event not
 * found". Someone reaching a cancelled event's URL usually bookmarked it or
 * holds a ticket to it; a dead end tells them nothing and offers no way on.
 */
export function slugResolvesOnlyToHiddenEvent<T extends DiscoveryEvent>(
  rows: T[] | null | undefined,
  slug: string,
): boolean {
  if (!slug || !rows?.length) return false;
  const titled = rows.filter((r) => slugify(r.title) === slug);
  return titled.length > 0 && !titled.some(isDiscoverableEvent);
}

/**
 * Someone who already holds the event — host, staff, ticket holder — opens it
 * whatever its status. This is the carve-out the discovery gate must not eat:
 * a cancelled event with 87 ticket holders still has to open for those 87.
 *
 * No production caller today, and that is the point: every ownership lane
 * (`/feed/events/[id]`, `/(protected)/events/[id]`, the ticket and QR screens,
 * the host dashboard) routes by numeric id and is already unconditional. This
 * is the gate to call if one of them ever grows a status check — so the answer
 * is written down once instead of re-derived as `status !== "cancelled"`.
 */
export function canOpenEventDirectly(
  event: DiscoveryEvent | null | undefined,
  relation?: { organizer?: boolean; staff?: boolean; ticket?: boolean } | null,
): boolean {
  if (!event) return false;
  if (relation?.organizer || relation?.staff || relation?.ticket) return true;
  return isDiscoverableEvent(event);
}
