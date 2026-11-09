import assert from "node:assert/strict";
import { test } from "node:test";
import { nearbyEventPins } from "./nearby-event-pins.ts";
const now = Date.parse("2026-11-09T00:00:00Z");
const area = { latitude: 40, longitude: -74, expiresAt: new Date(now + 60_000).toISOString() };
const pin = (id: string, latitude: number, longitude = -74) => ({ id, latitude, longitude, location: "Public venue", title: id });
test("Near You requires a fresh valid device area, not a selected event or saved city", () => {
  const pins = [pin("a", 40)];
  for (const value of [null, { ...area, expiresAt: "bad" }, { ...area, expiresAt: new Date(now).toISOString() }, { ...area, latitude: NaN }, { ...area, longitude: 181 }]) assert.deepEqual(nearbyEventPins(pins, value, now), []);
});
test("Near You sorts authorized public event pins, limits radius and never mutates map data", () => {
  const pins = [pin("far", 41), pin("near", 40.02), pin("nearest", 40.01), pin("bad", NaN)];
  assert.deepEqual(nearbyEventPins(pins, area, now).map(p => p.id), ["nearest", "near"]);
  assert.equal(pins[0].id, "far");
  assert.equal(nearbyEventPins(Array.from({ length: 20 }, (_, i) => pin(String(i), 40)), area, now).length, 10);
});
test("Near You handles opposite sides of the date line", () => {
  assert.equal(nearbyEventPins([pin("across", 0, -179.9)], { ...area, latitude: 0, longitude: 179.9 }, now).length, 1);
});
