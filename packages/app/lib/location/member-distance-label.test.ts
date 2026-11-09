import assert from "node:assert/strict";
import { test } from "node:test";
import { memberDistanceLabel } from "./member-distance-label.ts";
test("feed and profile labels use only the server-approved coarse distance bands", () => {
  assert.equal(memberDistanceLabel({ kind: "distance", band: "under_1", label: "0.01 miles away" }), "Less than a mile away");
  assert.equal(memberDistanceLabel({ kind: "distance", band: "1_5" }), "A few miles away");
  for (const value of [null, {}, { kind: "city", band: "under_1" }, { kind: "self", band: "under_1" }, { kind: "distance", band: "0.01" }, { kind: "distance", band: "__proto__" }]) assert.equal(memberDistanceLabel(value), null);
});

test("versioned exact labels require a live server lease", () => {
  const value = { kind: "distance", consentVersion: 2, miles: 0.01, expiresAt: new Date(Date.now() + 30000).toISOString() };
  assert.equal(memberDistanceLabel(value), "0.01 miles away");
  assert.equal(memberDistanceLabel({ ...value, miles: 1 }), "1.00 miles away");
  for (const patch of [{ consentVersion: 1 }, { expiresAt: "invalid" }, { expiresAt: "2000-01-01" }, { miles: NaN }, { miles: -1 }])
    assert.equal(memberDistanceLabel({ ...value, ...patch }), null);
});
