import test from "node:test";
import assert from "node:assert/strict";
import { decideLocationPermission } from "./location-permission.ts";

test("granted proceeds straight to the position lookup", () => {
  for (const platform of ["ios", "android", "web"]) {
    assert.deepEqual(
      decideLocationPermission({ status: "granted", canAskAgain: true, platform }),
      { kind: "proceed" },
    );
  }
});

test("undetermined asks the OS", () => {
  assert.deepEqual(
    decideLocationPermission({ status: "undetermined", canAskAgain: true, platform: "ios" }),
    { kind: "request" },
  );
  assert.deepEqual(
    decideLocationPermission({ status: "undetermined", canAskAgain: true, platform: "web" }),
    { kind: "request" },
  );
});

test("denied but still askable (Android first denial) asks again", () => {
  assert.deepEqual(
    decideLocationPermission({ status: "denied", canAskAgain: true, platform: "android" }),
    { kind: "request" },
  );
});

test("denied and not askable on native points at OS Settings", () => {
  assert.deepEqual(
    decideLocationPermission({ status: "denied", canAskAgain: false, platform: "ios" }),
    { kind: "blocked", canOpenSettings: true },
  );
  assert.deepEqual(
    decideLocationPermission({ status: "denied", canAskAgain: false, platform: "android" }),
    { kind: "blocked", canOpenSettings: true },
  );
});

test("browser-denied is blocked with no Settings link, even though expo reports canAskAgain", () => {
  // expo-location's web implementation always returns canAskAgain: true, but a
  // browser that has denied geolocation never prompts again.
  assert.deepEqual(
    decideLocationPermission({ status: "denied", canAskAgain: true, platform: "web" }),
    { kind: "blocked", canOpenSettings: false },
  );
});
