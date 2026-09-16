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

/**
 * Statuses that must never be offered to someone who wasn't already holding a
 * link to the row. Matched against the real constraint, which is
 * `events_status_check`: draft | active | cancelled | postponed | suspended.
 *
 * `active` and `postponed` are deliberately absent. A postponed event still
 * has to be findable — the people holding tickets need to see that it moved,
 * and hiding it turns a date change into a disappearance.
 *
 * "canceled" (one l) and "deleted" were in this list and cannot occur: the
 * CHECK rejects both. Keeping the spelling variant costs nothing and guards a
 * future rename; "deleted" is dropped because a reader would otherwise assume
 * soft-deletes exist here, and they do not — deletion removes the row.
 */
const HIDDEN_STATUSES = new Set(["cancelled", "canceled", "draft", "suspended"]);

export type DiscoveryEvent = {
  id?: number | string | null;
  title?: string | null;
  status?: string | null;
  created_at?: string | null;
  /** public | private | link_only. Undefined on callers that never select it. */
  visibility?: string | null;
  /** Random 32-hex share token (events.share_slug). */
  share_slug?: string | null;
};

/**
 * Share tokens are 32 hex chars — `replace(gen_random_uuid()::text, '-', '')`
 * in the DB default and `crypto.randomUUID()` with the dashes stripped in
 * create-event. Title slugs are `[a-z0-9-]` and effectively never this shape,
 * so a path segment can be classified without a round trip.
 */
const SHARE_TOKEN_RE = /^[0-9a-f]{32}$/;

export function isEventShareToken(segment: string | null | undefined): boolean {
  return typeof segment === "string" && SHARE_TOKEN_RE.test(segment);
}

/**
 * A title slug may only ever land on a PUBLIC event. This is the second half of
 * the link_only fix: tightening anon RLS stops a logged-out enumeration, but a
 * signed-in member can still list link_only rows (events_select_authenticated
 * is USING true), and slugify(title) over that list is exactly how "Wine &
 * Whiskey WEDNESDAY" was reachable at /events/wine-whiskey-wednesday.
 *
 * Undefined visibility reads as public: every currently-shared URL belongs to a
 * row created before this existed, and some callers select {id,title,status}
 * only. Excluding on absence would break those links, which is not allowed.
 */
function isTitleResolvable(event: DiscoveryEvent): boolean {
  const v = event.visibility;
  return v === undefined || v === null || v === "public";
}

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
 * ponytail: created_at, then id, is the whole tie-breaker. Two same-title live
 * PUBLIC events still collide, and the older one is unreachable by title slug —
 * it is reachable by id and by its own share token.
 */
export function resolveEventBySlug<T extends DiscoveryEvent>(
  rows: T[] | null | undefined,
  slug: string,
): T | undefined {
  if (!slug) return undefined;
  const matches = filterDiscoverableEvents(rows)
    .filter(isTitleResolvable)
    .filter((r) => slugify(r.title) === slug);
  if (matches.length < 2) return matches[0];
  // created_at only when every candidate carries it — some callers select
  // {id,title,status} only. Ids are monotonic, so a larger id is the newer row.
  const dated = matches.every((r) => Number.isFinite(Date.parse(r.created_at ?? "")));
  const key = (r: T) => (dated ? Date.parse(r.created_at ?? "") : Number(r.id) || 0);
  return matches.reduce((best, row) => (key(row) > key(best) ? row : best));
}

/**
 * Resolve a share token to one event. Exact match on `share_slug`, and never a
 * private or hidden-status row — the client-side mirror of
 * `public.get_event_by_share_token`, for callers that already hold rows.
 *
 * Possession of the token is the whole authorisation: it is 122 bits and only
 * ever travels in the link the host chose to send.
 */
export function resolveEventByShareToken<T extends DiscoveryEvent>(
  rows: T[] | null | undefined,
  token: string,
): T | undefined {
  if (!isEventShareToken(token)) return undefined;
  return filterDiscoverableEvents(rows).find(
    (r) =>
      r.share_slug === token &&
      (r.visibility === "public" || r.visibility === "link_only"),
  );
}

/**
 * One entry point for `/events/<segment>`: a token resolves anything shareable,
 * a title slug resolves public events only.
 */
export function resolveEventByPathSegment<T extends DiscoveryEvent>(
  rows: T[] | null | undefined,
  segment: string,
): T | undefined {
  return isEventShareToken(segment)
    ? resolveEventByShareToken(rows, segment)
    : resolveEventBySlug(rows, segment);
}

/**
 * The path a host hands out for one event. Lives next to the resolvers on
 * purpose: what we mint and what we resolve have to agree.
 *
 * link_only gets its token. After 20260917100000 that token is the only thing
 * that opens the event — anon RLS hides the row and slugify(title) no longer
 * resolves it — and an id-based path would be enumerable by counting, which is
 * the same hole in a different shape.
 *
 * Everything else keeps `/e/<id>`, which is what every already-shared link is.
 * A link_only event with no token (a row from before the backfill) also falls
 * back to `/e/<id>` rather than producing a URL that resolves to nothing.
 */
export function eventSharePath(event: {
  id: number | string;
  visibility?: string | null;
  shareSlug?: string | null;
}): string {
  const token = event.shareSlug;
  if (event.visibility === "link_only" && isEventShareToken(token)) {
    return `/events/${token}`;
  }
  return `/e/${event.id}`;
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
  // Same public-only gate as resolveEventBySlug: a cancelled link_only event
  // must read as missing, not as a cancellation someone can confirm by title.
  const titled = rows.filter((r) => isTitleResolvable(r) && slugify(r.title) === slug);
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
