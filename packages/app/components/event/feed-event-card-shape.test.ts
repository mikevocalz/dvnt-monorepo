import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { URL } from "node:url";
import { CARD_ASPECT, CARD_MAX_WIDTH, ESTIMATED_CARD_DETAILS_HEIGHT, feedEventCardHeight, feedEventCardMeasurementKey } from "./feed-event-card-shape.ts";
import { EVENT_FLYER_ASPECT } from "../../lib/events/flyer-layout.ts";
import { packMasonry, tileBounds } from "../feed/masonry-pack.ts";

test("feed uses a square canvas without changing the event page portrait ratio", () => {
  assert.equal(CARD_ASPECT, 1);
  assert.equal(EVENT_FLYER_ASPECT, 9 / 16);
  for (const width of [160, 320, 375, 384, 610, 768, 1320]) {
    assert.equal(feedEventCardHeight(width), (Math.min(width, CARD_MAX_WIDTH) - 8) / CARD_ASPECT + ESTIMATED_CARD_DETAILS_HEIGHT + 24);
  }
  assert.equal(feedEventCardHeight(768), feedEventCardHeight(384));
});

test("square event reservations leave subsequent posts below the entire card", () => {
  for (const numColumns of [1, 2, 3, 4]) {
    const opts = {
      tiles: Array.from({ length: 36 }, (_, i) => i % 7 === 0
        ? { kind: "event" as const, key: `e${i}`, event: i }
        : { kind: "post" as const, key: `p${i}`, post: i }),
      numColumns, columnWidth: 180, gap: 10,
      postHeight: (i: number) => 170 + i * 3,
      eventHeight: feedEventCardHeight,
    };
    const bounds = tileBounds(packMasonry(opts), opts);
    for (const a of bounds) for (const b of bounds) {
      if (a.key === b.key) continue;
      if (a.column + a.span <= b.column || b.column + b.span <= a.column) continue;
      assert.ok(a.bottom <= b.top || b.bottom <= a.top, `${a.key} overlaps ${b.key}`);
    }
  }
});

test("both platforms keep flyer media separate from metadata and preserve navigation", () => {
  const native = readFileSync(new URL("../feed/feed-event-card.tsx", import.meta.url), "utf8");
  const web = readFileSync(new URL("./FeedEventCard.web.tsx", import.meta.url), "utf8");
  assert.equal((native.match(/contentFit="cover"/g) || []).length, 2);
  assert.doesNotMatch(native, /LinearGradient|contentFit="contain"/);
  assert.match(native, /aspectRatio: CARD_ASPECT/);
  assert.match(native, /disabled=\{guestMode\}/);
  assert.match(native, /onRequireAuth\?\.\("events"\)/);
  assert.doesNotMatch(web, /height: (?:ESTIMATED_)?CARD_DETAILS_HEIGHT/);
  assert.doesNotMatch(native, /minHeight:|justifyContent: "flex-end"/);
  assert.match(web, /new ResizeObserver\(measure\)/);
  assert.match(web, /onHeightChange\(data.id, width, height\)/);
  assert.match(web, /maxWidth: CARD_MAX_WIDTH/);
  assert.match(web, /aspect=\{CARD_ASPECT\}/);
  assert.match(web, /contentFit="cover"/);
  assert.doesNotMatch(web, /linear-gradient/);
  assert.match(web, /<CardLink/);
  assert.match(web, /webEventDetailRoute\(data.id\)/);
  assert.doesNotMatch(web, /data.slug \?\? data.id/);
  assert.match(native, /pointerEvents="none" style=\{\{ width: "100%", aspectRatio: CARD_ASPECT \}\}/);
});


test("measurement keys separate widths but share the capped square size", () => {
  assert.notEqual(feedEventCardMeasurementKey("a", 280), feedEventCardMeasurementKey("a", 320));
  assert.equal(feedEventCardMeasurementKey("a", 384), feedEventCardMeasurementKey("a", 768));
  assert.notEqual(feedEventCardMeasurementKey("a", 320), feedEventCardMeasurementKey("b", 320));
});

test("masonry uses each event's measured extent instead of a fixed footer estimate", () => {
  const events = [{ id: "short", height: 520 }, { id: "long", height: 610 }];
  const opts = {
    tiles: events.map((event) => ({ kind: "event" as const, key: event.id, event })),
    numColumns: 2, columnWidth: 160, gap: 10, postHeight: () => 100,
    eventHeight: (_width: number, event: typeof events[number]) => event.height,
  };
  const result = packMasonry(opts);
  assert.deepEqual(result.heights, [1150, 1150]);
  const bounds = tileBounds(result, opts);
  assert.equal(bounds[0].bottom - bounds[0].top, 530);
  assert.equal(bounds[1].bottom - bounds[1].top, 620);
});

