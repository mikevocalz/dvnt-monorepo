/**
 * node --test packages/ui/src/video/RoomTimer.countdown.test.ts
 *
 *
 * Only the pure half is covered — `countdownAt` takes `now`, so the expiry rule
 * is testable without a clock, a timer, or a renderer. This rule was written
 * twice before, once per platform; these assertions are why it is written once.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  countdownAt,
  FREE_ROOM_DURATION_MS,
  COUNTDOWN_THRESHOLD_MS,
} from "./RoomTimer.countdown.ts";

const T0 = 1_700_000_000_000;
const at = (elapsedMs: number) => countdownAt(T0, FREE_ROOM_DURATION_MS, T0 + elapsedMs);

test("stays hidden until the last minute", () => {
  assert.equal(at(0).visible, false);
  assert.equal(at(FREE_ROOM_DURATION_MS - COUNTDOWN_THRESHOLD_MS - 1).visible, false);
});

test("appears exactly at the threshold", () => {
  assert.equal(at(FREE_ROOM_DURATION_MS - COUNTDOWN_THRESHOLD_MS).visible, true);
});

test("formats m:ss with a padded seconds field", () => {
  assert.equal(at(FREE_ROOM_DURATION_MS - 60_000).display, "1:00");
  assert.equal(at(FREE_ROOM_DURATION_MS - 7_000).display, "0:07");
  assert.equal(at(FREE_ROOM_DURATION_MS - 59_000).display, "0:59");
});

test("hides again once expired rather than showing 0:00 forever", () => {
  const done = at(FREE_ROOM_DURATION_MS);
  assert.equal(done.visible, false);
  assert.equal(done.expired, true);
  assert.equal(done.remainingMs, 0);
});

test("a clock that jumps past the end clamps instead of going negative", () => {
  const late = at(FREE_ROOM_DURATION_MS + 60_000);
  assert.equal(late.remainingMs, 0);
  assert.equal(late.display, "0:00");
  assert.equal(late.expired, true);
});

test("rounds up, so the badge never shows 0:00 while time remains", () => {
  // 500ms left is still time; showing 0:00 would read as expired.
  assert.equal(at(FREE_ROOM_DURATION_MS - 500).display, "0:01");
  assert.equal(at(FREE_ROOM_DURATION_MS - 500).expired, false);
});

test("a paid room with a longer allowance uses the same rule", () => {
  const hour = 60 * 60 * 1000;
  const c = countdownAt(T0, hour, T0 + hour - 30_000);
  assert.equal(c.visible, true);
  assert.equal(c.display, "0:30");
});
