import { URL } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";
import { coarseMapPoint, mapGrantActive, acceptSettings } from "./location-access.ts";
const now = Date.parse("2026-10-24T16:00:00Z");
const on = { locationEnabled: true, eventsMapEnabled: true, revision: 2, shareUntil: new Date(now + 60_000).toISOString() };
test("both explicit permissions and fresh grant required, legacy grants never sufficient", () => {
  assert.equal(mapGrantActive(null, now), false);
  assert.equal(mapGrantActive({ ...on, locationEnabled: false }, now), false);
  assert.equal(mapGrantActive({ ...on, eventsMapEnabled: false }, now), false);
  assert.equal(mapGrantActive({ ...on, shareUntil: null }, now), false);
  assert.equal(mapGrantActive({ ...on, shareUntil: "bad" }, now), false);
  assert.equal(mapGrantActive(on, now), true);
  assert.equal(mapGrantActive(on, now + 60_000), false);
});
test("only coarse grid point leaves device and quantization is stable", () => {
  const point = coarseMapPoint(40.812345, -73.912345);
  assert.notEqual(point.latitude, 40.812345);
  assert.notEqual(point.longitude, -73.912345);
  assert.deepEqual(coarseMapPoint(point.latitude, point.longitude), point);
  for (const values of [[NaN, 0], [0, Infinity], [86, 0], [0, 181]]) assert.throws(() => coarseMapPoint(values[0]!, values[1]!));
});
test("older settings cannot restore sharing after server withdrawal", () => {
  const off = { ...on, revision: 3, locationEnabled: false, eventsMapEnabled: false };
  assert.equal(acceptSettings(off, on), false);
  assert.equal(acceptSettings(on, off), true);
  assert.equal(acceptSettings(null, { ...on, revision: -1 }), false);
});

test("all device-collection entry points honor overall permission and stale callback guards", async () => {
  const { readFileSync } = await import("node:fs");
  const collectors = [
    "../hooks/use-boot-location.ts", "../hooks/use-device-location.ts",
    "../../features/events/ui/city-picker-sheet.tsx",
    "../../features/auth/screens/WelcomeScreen.web.tsx",
    "../../features/routes/screens/(protected)/welcome.tsx",
    "../../components/ui/location-autocomplete-instagram.tsx",
    "../../features/presence/arrival-presence.ts",
  ];
  for (const file of collectors) {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    assert.match(source, /locationAllowedFor/, `${file} master gate`);
    assert.match(source, /generation/, `${file} invalidates callbacks`);
  }
  const places = readFileSync(new URL("../hooks/use-places-autocomplete.ts", import.meta.url), "utf8");
  assert.doesNotMatch(places, /getCurrentPosition|requestForegroundPermissions/, "places search never prompts or samples automatically");
  assert.match(places, /allowIpBias: access\.enabled/);
  const controller = readFileSync(new URL("../hooks/use-member-map.ts", import.meta.url), "utf8");
  assert.match(controller, /memberMapApi\.revoke\(owner, kind === "overall"/);
  assert.match(controller, /mapGrantActive\(useLocationAccessStore\.getState\(\)\.settings, Date\.now\(\)\)/);
});
