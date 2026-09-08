import test from "node:test";
import assert from "node:assert/strict";
import {
  EMPTY_FEED_CURSOR,
  buildFeedSlots,
  type FeedSlot,
} from "./feed-slots.ts";

type P = { id: string };
type E = { id: string };

const posts = (n: number, o = 0): P[] =>
  Array.from({ length: n }, (_, i) => ({ id: `p${i + o}` }));
const events = (n: number, o = 0): E[] =>
  Array.from({ length: n }, (_, i) => ({ id: `e${i + o}` }));
const boosts = (n: number, o = 0) =>
  Array.from({ length: n }, (_, i) => ({
    event: { id: `b${i + o}` },
    campaignId: i + o,
    placementToken: `tok-${i + o}`,
  }));

const eventId = (e: E) => e.id;
const kinds = (slots: FeedSlot<P, E>[]) => slots.map((s) => s.type);
const base = { eventId, googleSlotsAllowed: true } as const;

test("a free viewer alternates event, ad, event, ad at every interval", () => {
  const { slots } = buildFeedSlots({
    ...base,
    posts: posts(28),
    events: events(4),
  });
  assert.deepEqual(kinds(slots), [
    "masonry", "organic_event",
    "masonry", "google_ad",
    "masonry", "organic_event",
    "masonry", "google_ad",
  ]);
});

test("a paid viewer gets an unsponsored event where the ad would be, never a boost", () => {
  const { slots } = buildFeedSlots({
    ...base,
    googleSlotsAllowed: false,
    posts: posts(28),
    events: events(4),
    promoted: boosts(4),
  });
  assert.equal(kinds(slots).includes("google_ad"), false, "no ad slots");
  const fills = slots.filter((s) => s.type !== "masonry");
  // Slot 1 and 3 are event slots and may be boosts. Slot 2 and 4 replaced ads
  // and must NOT be.
  assert.equal(fills[0].type, "promoted_event");
  assert.equal(fills[1].type, "organic_event", "an ad slot never backfills a boost");
  assert.equal(fills[2].type, "promoted_event");
  assert.equal(fills[3].type, "organic_event", "an ad slot never backfills a boost");
});

test("boosts fill event slots ahead of ordinary recommendations", () => {
  const { slots } = buildFeedSlots({
    ...base,
    posts: posts(7),
    events: events(3),
    promoted: boosts(1),
  });
  const fill = slots.find((s) => s.type !== "masonry");
  assert.equal(fill?.type, "promoted_event");
  assert.equal(fill?.type === "promoted_event" && fill.campaignId, 0);
  assert.equal(fill?.type === "promoted_event" && fill.placementToken, "tok-0");
});

test("no post is dropped and order never changes, whatever the remainder", () => {
  for (const n of [0, 1, 6, 7, 8, 13, 14, 27, 100]) {
    const { slots } = buildFeedSlots({ ...base, posts: posts(n), events: events(20) });
    const seen = slots
      .filter((s) => s.type === "masonry")
      .flatMap((s) => (s as Extract<FeedSlot<P, E>, { type: "masonry" }>).posts.map((p) => p.id));
    assert.equal(seen.length, n, `lost posts at ${n}`);
    assert.deepEqual(seen, posts(n).map((p) => p.id), `reordered at ${n}`);
  }
});

test("a feed shorter than one interval is never padded with a promotion", () => {
  const { slots } = buildFeedSlots({
    ...base,
    posts: posts(4),
    events: events(9),
    promoted: boosts(9),
  });
  assert.deepEqual(kinds(slots), ["masonry"]);
});

test("pagination continues the sequence instead of restarting at E1", () => {
  const page1 = buildFeedSlots({ ...base, posts: posts(7), events: events(4) });
  assert.deepEqual(kinds(page1.slots), ["masonry", "organic_event"]);
  assert.equal(page1.nextCursor.boundariesCrossed, 1);

  // Page two opens on boundary 2, which is a Google slot — not another E1.
  const page2 = buildFeedSlots({
    ...base,
    posts: posts(7, 7),
    events: events(4),
    cursor: page1.nextCursor,
  });
  assert.deepEqual(kinds(page2.slots), ["masonry", "google_ad"]);
  assert.equal(page2.nextCursor.boundariesCrossed, 2);
});

test("an event already emitted on an earlier page is not emitted again", () => {
  const page1 = buildFeedSlots({ ...base, posts: posts(7), events: events(2) });
  const first = page1.slots.find((s) => s.type === "organic_event");
  assert.equal(first?.type === "organic_event" && first.event.id, "e0");

  const page3 = buildFeedSlots({
    ...base,
    posts: posts(7, 14),
    events: events(2),
    cursor: { boundariesCrossed: 2, seenEventIds: page1.nextCursor.seenEventIds },
  });
  const second = page3.slots.find((s) => s.type === "organic_event");
  assert.equal(second?.type === "organic_event" && second.event.id, "e1", "no repeat");
});

test("a boost is never duplicated against an organic appearance of the same event", () => {
  const shared = { id: "e0" };
  const { slots } = buildFeedSlots({
    ...base,
    posts: posts(21),
    events: [shared, { id: "e1" }],
    promoted: [{ event: shared, campaignId: 9, placementToken: "t9" }],
  });
  const ids = slots
    .filter((s) => s.type === "promoted_event" || s.type === "organic_event")
    .map((s) => (s as { event: E }).event.id);
  assert.equal(new Set(ids).size, ids.length, `duplicate event in ${ids.join(",")}`);
});

test("with nothing to place, the post run stays intact rather than showing a blank", () => {
  const { slots } = buildFeedSlots({
    ...base,
    googleSlotsAllowed: false,
    posts: posts(21),
    events: [],
    promoted: [],
  });
  assert.deepEqual(kinds(slots), ["masonry"], "one uninterrupted run");
});

test("a Google no-fill does not advance the next ad's turn", () => {
  // The builder emits opportunities; a slot that could not be filled is simply
  // not emitted, so the following boundary keeps its own identity.
  const { slots, nextCursor } = buildFeedSlots({
    ...base,
    posts: posts(14),
    events: events(1),
  });
  assert.deepEqual(kinds(slots), ["masonry", "organic_event", "masonry", "google_ad"]);
  assert.equal(nextCursor.boundariesCrossed, 2);
});

test("the web rail halves the in-feed cadence rather than doubling the Google surfaces", () => {
  const withRail = buildFeedSlots({
    ...base,
    posts: posts(56),
    events: events(8),
    railVisible: true,
  });
  const withoutRail = buildFeedSlots({
    ...base,
    posts: posts(56),
    events: events(8),
    railVisible: false,
  });
  const ads = (r: typeof withRail) =>
    r.slots.filter((s) => s.type === "google_ad").length;
  assert.equal(ads(withoutRail), 4);
  assert.equal(ads(withRail), 2, "every second Google slot only");
  // The slots the rail gave up became unsponsored events, not boosts.
  assert.equal(
    withRail.slots.filter((s) => s.type === "promoted_event").length,
    0,
  );
});

test("an empty cursor and no cursor behave identically", () => {
  const a = buildFeedSlots({ ...base, posts: posts(14), events: events(2) });
  const b = buildFeedSlots({
    ...base,
    posts: posts(14),
    events: events(2),
    cursor: EMPTY_FEED_CURSOR,
  });
  assert.deepEqual(kinds(a.slots), kinds(b.slots));
});
