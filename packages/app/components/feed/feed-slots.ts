/**
 * The logical feed contract.
 *
 * `buildFeedSections` decides where an event card goes. This decides what kind
 * of thing goes in each of those places — organic event, paid boost, Google
 * opportunity, house ad — and it is the only thing that knows the cadence.
 *
 * Three feeds currently re-implement "an event every seven posts" separately
 * (`feed.tsx`, `masonry-feed.tsx` via the shared builder, and
 * `features/home/screen.web.tsx`). They consume this instead, so the rule stops
 * being three rules that agree by coincidence.
 *
 * RN-free, like `feed-sections.ts`, so web and native can both import it.
 *
 * A `google_ad` slot is an OPPORTUNITY, never a creative. Nothing here knows
 * whether a request will be made or filled — that is `lib/ads/ad-eligibility`
 * and the renderer. This decides only where an ad would be allowed to go.
 */

import { EVENT_INTERVAL } from "./feed-sections.ts";

export type FeedSlot<Post, Event> =
  | { type: "masonry"; key: string; posts: Post[] }
  | { type: "organic_event"; key: string; event: Event }
  | {
      type: "promoted_event";
      key: string;
      event: Event;
      campaignId: number;
      /** Issued server-side; what a qualified impression is deduped against. */
      placementToken: string;
    }
  | { type: "google_ad"; key: string; placementId: string }
  | { type: "house_ad"; key: string; placementKey: string };

export interface PromotedCandidate<Event> {
  event: Event;
  campaignId: number;
  placementToken: string;
}

/**
 * Carried across pages so the sequence continues rather than restarting at
 * E1/G1 on every fetch, and so frequency caps survive pull-to-refresh.
 */
export interface FeedCursor {
  /** Interval boundaries crossed so far, across every page. */
  boundariesCrossed: number;
  /** Event ids already emitted, organic or promoted. */
  seenEventIds: readonly string[];
}

export const EMPTY_FEED_CURSOR: FeedCursor = {
  boundariesCrossed: 0,
  seenEventIds: [],
};

export interface BuildFeedSlotsInput<Post, Event> {
  posts: readonly Post[];
  /** Ordinary recommendations, already ranked. */
  events: readonly Event[];
  /** Eligible boosts, already selected and rotated server-side. */
  promoted?: readonly PromotedCandidate<Event>[];
  cursor?: FeedCursor;
  /**
   * `false` for a viewer with `adsGoogleFree`, an unresolved entitlement, or a
   * closed kill switch. It never means "show more boosts instead".
   */
  googleSlotsAllowed: boolean;
  /**
   * Web only. With the right rail carrying a unit, the in-feed cadence drops to
   * every second Google slot so a wide desktop is not showing two Google
   * surfaces per screenful.
   */
  railVisible?: boolean;
  interval?: number;
  /** Ad unit id for in-feed placements. */
  placementId?: string;
  eventId: (event: Event) => string;
}

export interface BuildFeedSlotsResult<Post, Event> {
  slots: FeedSlot<Post, Event>[];
  nextCursor: FeedCursor;
}

/**
 * A feed shorter than one interval is never padded with a promotion. A member
 * with four posts to read is not shown an ad and two boosts to fill the screen.
 */
export function buildFeedSlots<Post, Event>(
  input: BuildFeedSlotsInput<Post, Event>,
): BuildFeedSlotsResult<Post, Event> {
  const {
    posts,
    events,
    promoted = [],
    cursor = EMPTY_FEED_CURSOR,
    googleSlotsAllowed,
    railVisible = false,
    interval = EVENT_INTERVAL,
    placementId = "home_feed_native",
    eventId,
  } = input;

  const slots: FeedSlot<Post, Event>[] = [];
  const seen = new Set(cursor.seenEventIds);
  let boundaries = cursor.boundariesCrossed;

  if (!Number.isFinite(interval) || interval < 1 || posts.length === 0) {
    if (posts.length) {
      slots.push({ type: "masonry", key: `m-${boundaries}-0`, posts: [...posts] });
    }
    return { slots, nextCursor: { boundariesCrossed: boundaries, seenEventIds: [...seen] } };
  }

  let promotedIdx = 0;
  let organicIdx = 0;
  let chunkStart = 0;

  const nextPromoted = (): PromotedCandidate<Event> | null => {
    while (promotedIdx < promoted.length) {
      const candidate = promoted[promotedIdx++];
      if (!seen.has(eventId(candidate.event))) return candidate;
    }
    return null;
  };

  const nextOrganic = (): Event | null => {
    while (organicIdx < events.length) {
      const event = events[organicIdx++];
      if (!seen.has(eventId(event))) return event;
    }
    return null;
  };

  for (let i = 0; i < posts.length; i++) {
    if ((i + 1) % interval !== 0) continue;

    // Boundaries alternate: odd is an event slot, even is a Google slot.
    const boundaryNumber = boundaries + 1;
    const isEventSlot = boundaryNumber % 2 === 1;
    const googleSlotNumber = Math.ceil(boundaryNumber / 2);

    const filler = isEventSlot
      ? eventSlot()
      : googleSlot(googleSlotNumber);

    // Nothing to place — leave the run intact rather than emit a blank box.
    if (!filler) continue;

    if (i >= chunkStart) {
      slots.push({
        type: "masonry",
        key: `m-${chunkStart}-${boundaries}`,
        posts: posts.slice(chunkStart, i + 1),
      });
    }
    slots.push(filler);
    boundaries = boundaryNumber;
    chunkStart = i + 1;
  }

  if (chunkStart < posts.length) {
    slots.push({
      type: "masonry",
      key: `m-${chunkStart}-${boundaries}`,
      posts: posts.slice(chunkStart),
    });
  }

  return {
    slots,
    nextCursor: { boundariesCrossed: boundaries, seenEventIds: [...seen] },
  };

  /** An eligible boost first, then an ordinary recommendation. */
  function eventSlot(): FeedSlot<Post, Event> | null {
    const boost = nextPromoted();
    if (boost) {
      seen.add(eventId(boost.event));
      return {
        type: "promoted_event",
        key: `pe-${eventId(boost.event)}`,
        event: boost.event,
        campaignId: boost.campaignId,
        placementToken: boost.placementToken,
      };
    }
    const organic = nextOrganic();
    if (!organic) return null;
    seen.add(eventId(organic));
    return { type: "organic_event", key: `oe-${eventId(organic)}`, event: organic };
  }

  /**
   * A Google slot the viewer cannot be served becomes an UNSPONSORED
   * recommendation, or nothing. Never another boost: removing a Google
   * placement is not an opportunity to sell more, and a paid member noticing
   * that their ads became sponsored events would be right to be annoyed.
   */
  function googleSlot(slotNumber: number): FeedSlot<Post, Event> | null {
    const railTakesEveryOther = railVisible && slotNumber % 2 === 0;
    if (!googleSlotsAllowed || railTakesEveryOther) {
      const organic = nextOrganic();
      if (!organic) return null;
      seen.add(eventId(organic));
      return {
        type: "organic_event",
        key: `oe-${eventId(organic)}`,
        event: organic,
      };
    }
    return { type: "google_ad", key: `g-${slotNumber}`, placementId };
  }
}
