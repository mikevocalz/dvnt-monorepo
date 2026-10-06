/**
 * node --test packages/app/features/call/call-session-limit.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  callSessionSecondsRemaining,
  formatCallSessionCountdown,
  shouldShowCallSessionWarning,
} from "./call-session-limit.ts";

test("countdown derives only from the server deadline", () => {
  const now = Date.parse("2026-10-06T22:00:00.000Z");
  assert.equal(
    callSessionSecondsRemaining("2026-10-06T22:00:30.000Z", now),
    30,
  );
  assert.equal(
    callSessionSecondsRemaining("2026-10-06T22:05:00.000Z", now),
    300,
  );
});

test("warning is visible only for the final thirty seconds", () => {
  assert.equal(shouldShowCallSessionWarning(31), false);
  assert.equal(shouldShowCallSessionWarning(30), true);
  assert.equal(shouldShowCallSessionWarning(1), true);
  assert.equal(shouldShowCallSessionWarning(0), false);
  assert.equal(shouldShowCallSessionWarning(null), false);
});

test("expired and invalid deadlines fail safe", () => {
  const now = Date.parse("2026-10-06T22:00:00.000Z");
  assert.equal(
    callSessionSecondsRemaining("2026-10-06T21:59:59.000Z", now),
    0,
  );
  assert.equal(callSessionSecondsRemaining("not-a-date", now), null);
  assert.equal(callSessionSecondsRemaining(null, now), null);
});

test("countdown uses stable m:ss formatting", () => {
  assert.equal(formatCallSessionCountdown(30), "0:30");
  assert.equal(formatCallSessionCountdown(7), "0:07");
  assert.equal(formatCallSessionCountdown(300), "5:00");
});
