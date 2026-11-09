import assert from "node:assert/strict";
import { test } from "node:test";
import { freshDeviceObservation } from "./device-observation.ts";
const now = 1_800_000_000_000;
const sample = { observedAt: now - 10_000, ownerAuthId: "a", sessionKey: "s1" };
test("provider observation remains original across consent/city updates", () => {
  assert.equal(freshDeviceObservation(sample, "a", "s1", now), now - 10_000);
  assert.equal(freshDeviceObservation(sample, "a", "s1", now + 10_000), now - 10_000);
  assert.equal(freshDeviceObservation(sample, "a", "s1", now + 60_000), null);
});
test("missing, ancient, future and prior-session observations cannot publish", () => {
  for (const value of [null, undefined, {...sample,observedAt:NaN}, {...sample,observedAt:now-900_001}, {...sample,observedAt:now+5_001}]) {
    assert.equal(freshDeviceObservation(value,"a","s1",now),null);
  }
  assert.equal(freshDeviceObservation(sample,"a","s2",now),null);
  assert.equal(freshDeviceObservation(sample,"b","s1",now),null);
  assert.equal(freshDeviceObservation(sample,"a",undefined,now),null);
});
