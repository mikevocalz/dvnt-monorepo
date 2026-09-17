/**
 * The limit is 60 seconds, inclusive. A 60s export must upload; the check only
 * exists to stop a 3-minute file after the pick instead of after the upload.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { MAX_VIDEO_SECONDS, isWithinVideoLimit } from "./video-duration.web.ts";

test("60 seconds is allowed, 61 is not", () => {
  assert.equal(MAX_VIDEO_SECONDS, 60);
  assert.equal(isWithinVideoLimit(60), true);
  assert.equal(isWithinVideoLimit(61), false);
});

test("a 60s timeline exported at 60.2s still passes", () => {
  assert.equal(isWithinVideoLimit(60.2), true);
  assert.equal(isWithinVideoLimit(60.6), false);
});

test("unknown duration is the server's call, not a rejection", () => {
  assert.equal(isWithinVideoLimit(null), true);
});
