import { test } from "node:test";
import assert from "node:assert/strict";
import {
  feedMediaMode,
  showsCarouselDots,
  dotWindowStart,
  DOT_WINDOW,
} from "./feed-media-mode.ts";

const img = { type: "image" };
const vid = { type: "video" };

test("a video first no longer swallows the rest of the post", () => {
  // The regression: this rendered the video alone, images unreachable, no dots.
  assert.equal(feedMediaMode([vid, img, img]), "carousel");
  assert.equal(showsCarouselDots(feedMediaMode([vid, img, img])), true);
});

test("every mix of two or more items is a carousel with dots", () => {
  for (const media of [
    [img, img],
    [vid, vid],
    [img, vid],
    [vid, img],
    [img, vid, img, vid],
  ]) {
    assert.equal(feedMediaMode(media), "carousel", JSON.stringify(media));
    assert.equal(showsCarouselDots(feedMediaMode(media)), true);
  }
});

test("one video still gets the standalone player, not a one-slide carousel", () => {
  assert.equal(feedMediaMode([vid]), "single-video");
  assert.equal(showsCarouselDots(feedMediaMode([vid])), false);
});

test("one image, no media, and text posts never show dots", () => {
  assert.equal(feedMediaMode([img]), "single");
  assert.equal(feedMediaMode([]), "single");
  assert.equal(feedMediaMode(null), "single");
  assert.equal(feedMediaMode([img, img], { isTextPost: true }), "text");
  for (const mode of ["single", "text"] as const) {
    assert.equal(showsCarouselDots(mode), false);
  }
});

test("an unknown or missing media type is treated as an image, not a video", () => {
  // Never hand the standalone player a slide it cannot play.
  assert.equal(feedMediaMode([{}]), "single");
  assert.equal(feedMediaMode([{ type: "gif" }]), "single");
});

test("the dot window stays inside the run and follows the active slide", () => {
  assert.equal(dotWindowStart(3, 0), 0); // short runs never scroll
  assert.equal(dotWindowStart(DOT_WINDOW, 6), 0);

  // Long run: clamped at the start, centred in the middle, clamped at the end.
  assert.equal(dotWindowStart(20, 0), 0);
  assert.equal(dotWindowStart(20, 10), 10 - Math.floor(DOT_WINDOW / 2));
  assert.equal(dotWindowStart(20, 19), 20 - DOT_WINDOW);

  // The active slide is always inside the window, at every position.
  for (let count = 1; count <= 30; count++) {
    for (let current = 0; current < count; current++) {
      const start = dotWindowStart(count, current);
      const shown = Math.min(count, DOT_WINDOW);
      assert.ok(start >= 0, `start ${start} < 0`);
      assert.ok(start + shown <= count, `window overruns at ${count}/${current}`);
      assert.ok(
        current >= start && current < start + shown,
        `slide ${current} outside window at count ${count}`,
      );
    }
  }
});
