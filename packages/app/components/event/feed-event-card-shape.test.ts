import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CARD_ASPECT, CARD_MAX_WIDTH, CARD_DETAILS_HEIGHT, feedEventCardHeight } from "./feed-event-card-shape.ts";
import { EVENT_FLYER_ASPECT } from "../../lib/events/flyer-layout.ts";
import { packMasonry, tileBounds } from "../feed/masonry-pack.ts";

test("feed uses the event page portrait canvas with bounded responsive width", () => {
  assert.equal(CARD_ASPECT, EVENT_FLYER_ASPECT);
  assert.equal(CARD_ASPECT, 9 / 16);
  for (const width of [160, 320, 375, 384, 610, 768, 1320]) {
    assert.equal(feedEventCardHeight(width), (Math.min(width, CARD_MAX_WIDTH) - 8) / CARD_ASPECT + CARD_DETAILS_HEIGHT + 24);
  }
  assert.equal(feedEventCardHeight(768), feedEventCardHeight(384));
});

test("portrait event reservations leave subsequent posts below the entire card", () => {
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
  assert.equal((native.match(/contentFit="contain"/g) || []).length, 2);
  assert.doesNotMatch(native, /LinearGradient|contentFit="cover"/);
  assert.match(native, /aspectRatio: CARD_ASPECT/);
  assert.match(native, /disabled=\{guestMode\}/);
  assert.match(native, /onRequireAuth\?\.\("events"\)/);
  assert.match(web, /height: CARD_DETAILS_HEIGHT/);
  assert.match(web, /maxWidth: CARD_MAX_WIDTH/);
  assert.match(web, /aspect=\{CARD_ASPECT\}/);
  assert.doesNotMatch(web, /linear-gradient/);
  assert.match(web, /e.key === "Enter" \|\| e.key === " "/);
});
