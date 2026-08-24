/**
 * node --test packages/app/features/sneaky-lynk/session/moq-transport.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  transportStatusFromMoq,
  isDegradedLink,
  DEGRADED_LOSS_RATIO,
  DEGRADED_RTT_MS,
} from "./moq-transport.ts";

test("a dropped session reads as connecting, not error — the machine decides", () => {
  // MoQ has no `reconnecting`; a re-establish looks identical to a first join.
  assert.equal(transportStatusFromMoq("connecting"), "connecting");
});

test("a cleanly closed room is disconnected, never an error", () => {
  // Calling it an error would send the machine retrying a room that is gone.
  assert.equal(transportStatusFromMoq("closed"), "disconnected");
});

test("any error variant maps to error", () => {
  assert.equal(transportStatusFromMoq("error:transport"), "error");
  assert.equal(transportStatusFromMoq("error:auth failed"), "error");
  assert.equal(transportStatusFromMoq("error:"), "error");
});

test("idle and connected pass through", () => {
  assert.equal(transportStatusFromMoq("idle"), "idle");
  assert.equal(transportStatusFromMoq("connected"), "connected");
});

test("an unknown future state does not tear down a working room", () => {
  assert.equal(transportStatusFromMoq("suspended" as never), "connecting");
});

test("high round-trip degrades the link", () => {
  assert.equal(isDegradedLink({ roundTripTimeMs: DEGRADED_RTT_MS + 1 }), true);
  assert.equal(isDegradedLink({ roundTripTimeMs: DEGRADED_RTT_MS }), false);
});

test("loss is judged as a ratio, not a count", () => {
  // 50 lost of 1000 is fine; 50 lost of 200 is not.
  assert.equal(isDegradedLink({ packetsLost: 50, packetsReceived: 1950 }), false);
  assert.equal(isDegradedLink({ packetsLost: 50, packetsReceived: 150 }), true);
  assert.ok(DEGRADED_LOSS_RATIO > 0 && DEGRADED_LOSS_RATIO < 1);
});

test("no traffic yet is not evidence of a bad link", () => {
  assert.equal(isDegradedLink({ packetsLost: 0, packetsReceived: 0 }), false);
  assert.equal(isDegradedLink({}), false);
});
