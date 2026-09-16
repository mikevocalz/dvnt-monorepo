import test from "node:test";
import assert from "node:assert/strict";
import { feedColumnCount, readFeedMode } from "./feed-layout-preference.ts";

test("both explicit layout choices survive a read on app restart", () => {
  assert.equal(readFeedMode("classic"), "classic");
  assert.equal(readFeedMode("masonry"), "masonry");
});

test("missing or corrupt storage falls back to the grid without inventing a mode", () => {
  for (const value of [undefined, null, "", "grid", true, {}]) {
    assert.equal(readFeedMode(value), "masonry");
  }
});

test("web list choice stays a single column at phone, tablet and desktop widths", () => {
  for (const width of [320, 680, 1024, 1920]) assert.equal(feedColumnCount("classic", width), 1);
  assert.equal(feedColumnCount("masonry", 320), 2);
  assert.equal(feedColumnCount("masonry", 680), 3);
  assert.equal(feedColumnCount("masonry", 1024), 4);
});
