/**
 * Feed section building — masonry chunks interleaved with event cards.
 *
 * Extracted from masonry-feed.tsx so the web feed can use the same rule. Web
 * rendered posts only, so event cards appeared in the feed on mobile and never
 * on web; sharing the function is what stops the two drifting again.
 *
 * RN-free on purpose: masonry-feed.tsx imports LegendList and expo modules, so
 * nothing could import its logic without dragging native code along.
 */

import { buildFeedSlots } from "./feed-slots.ts";

/** One event card every N posts. */
export const EVENT_INTERVAL = 7;

export type FeedSection<Post, Event> =
  | { type: "masonry"; key: string; posts: Post[] }
  | { type: "event"; key: string; event: Event };

/**
 * Chunks `posts` into masonry runs, dropping an event card after every
 * `EVENT_INTERVAL` posts until the events run out. Trailing posts always flush
 * as a final masonry section, so no post is dropped when the counts do not
 * divide evenly.
 *
 * A narrowed view of `buildFeedSlots` for callers that only ever show organic
 * events — the masonry feed, which passes its own much larger `interval` for
 * virtualization reasons rather than the seven-post cadence.
 */
export function buildFeedSections<
  Post extends { id: string | number },
  Event extends { id: string | number },
>(
  posts: Post[],
  events: Event[],
  interval: number = EVENT_INTERVAL,
): FeedSection<Post, Event>[] {
  // Delegates to the slot builder so there is ONE implementation of the
  // interleave rule. With no Google slots and no boosts, every interval
  // boundary resolves to an ordinary event, which is exactly what this
  // function has always produced — the tests below this file are the proof.
  const { slots } = buildFeedSlots<Post, Event>({
    posts,
    events,
    googleSlotsAllowed: false,
    interval,
    eventId: (event) => String(event.id),
  });

  return slots.flatMap((slot): FeedSection<Post, Event>[] => {
    if (slot.type === "masonry") {
      return [{ type: "masonry", key: slot.key, posts: slot.posts }];
    }
    if (slot.type === "organic_event" || slot.type === "promoted_event") {
      return [{ type: "event", key: slot.key, event: slot.event }];
    }
    // A feed that asks for no ad slots cannot receive one.
    return [];
  });
}
