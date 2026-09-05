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
 */
export function buildFeedSections<
  Post extends { id: string | number },
  Event extends { id: string | number },
>(
  posts: Post[],
  events: Event[],
  interval: number = EVENT_INTERVAL,
): FeedSection<Post, Event>[] {
  const sections: FeedSection<Post, Event>[] = [];
  // A non-positive interval would place an event between every post (or loop);
  // treat it as "no interleaving" rather than producing a broken feed.
  if (!Number.isFinite(interval) || interval < 1) {
    return posts.length ? [{ type: "masonry", key: "m-0", posts }] : [];
  }

  let eventIdx = 0;
  let chunkStart = 0;

  for (let i = 0; i < posts.length; i++) {
    if ((i + 1) % interval === 0 && eventIdx < events.length) {
      if (i >= chunkStart) {
        sections.push({
          type: "masonry",
          key: `m-${chunkStart}`,
          posts: posts.slice(chunkStart, i + 1),
        });
      }
      sections.push({
        type: "event",
        key: `e-${events[eventIdx].id}`,
        event: events[eventIdx],
      });
      eventIdx++;
      chunkStart = i + 1;
    }
  }

  if (chunkStart < posts.length) {
    sections.push({
      type: "masonry",
      key: `m-${chunkStart}`,
      posts: posts.slice(chunkStart),
    });
  }

  return sections;
}
