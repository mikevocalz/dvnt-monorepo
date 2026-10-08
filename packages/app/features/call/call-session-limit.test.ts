/**
 * node --test packages/app/features/call/call-session-limit.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  callSessionSecondsRemaining,
  fetchCallDeadline,
  serverClockOffsetMs,
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

const SERVER_NOW = "2026-10-06T22:00:00.000Z";
const ENDS_AT = "2026-10-06T22:05:00.000Z";
const FIVE_MIN = 5 * 60 * 1000;

test("a phone clock five minutes fast still sees the full five minutes", () => {
  const deviceNow = Date.parse(SERVER_NOW) + FIVE_MIN + 1000;
  const offset = serverClockOffsetMs(SERVER_NOW, deviceNow, deviceNow);
  assert.equal(offset, -(FIVE_MIN + 1000));
  // Without the offset this device would hang up immediately.
  assert.equal(callSessionSecondsRemaining(ENDS_AT, deviceNow), 0);
  assert.equal(callSessionSecondsRemaining(ENDS_AT, deviceNow, offset), 300);
  assert.equal(callSessionSecondsRemaining(ENDS_AT, deviceNow + 299_000, offset), 1);
  assert.equal(callSessionSecondsRemaining(ENDS_AT, deviceNow + 300_000, offset), 0);
});

test("a phone clock five minutes slow does not overrun the deadline", () => {
  const deviceNow = Date.parse(SERVER_NOW) - FIVE_MIN;
  const offset = serverClockOffsetMs(SERVER_NOW, deviceNow, deviceNow);
  assert.equal(callSessionSecondsRemaining(ENDS_AT, deviceNow), 600);
  assert.equal(callSessionSecondsRemaining(ENDS_AT, deviceNow, offset), 300);
});

test("offset uses the request midpoint and falls back to 0 without serverNow", () => {
  const start = Date.parse(SERVER_NOW) - 400;
  assert.equal(serverClockOffsetMs(SERVER_NOW, start, start + 800), 0);
  assert.equal(serverClockOffsetMs(undefined, start, start + 800), 0);
  assert.equal(serverClockOffsetMs("garbage", start), 0);
});

test("fetchCallDeadline returns the row's ends_at, null when unset, undefined on failure", async () => {
  const ok = (data: { ends_at: string | null } | null) => () =>
    Promise.resolve({ data, error: null });
  assert.equal(await fetchCallDeadline(ok({ ends_at: ENDS_AT })), ENDS_AT);
  assert.equal(await fetchCallDeadline(ok({ ends_at: null })), null);
  assert.equal(await fetchCallDeadline(ok(null)), undefined);
  assert.equal(
    await fetchCallDeadline(() => Promise.resolve({ data: null, error: { message: "rls" } })),
    undefined,
  );
  assert.equal(await fetchCallDeadline(() => Promise.reject(new Error("offline"))), undefined);
});
