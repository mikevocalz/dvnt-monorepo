import test from "node:test";
import assert from "node:assert/strict";
import {
  applyCityVisibility,
  applyFindEventsMode,
  applyRevokeCityVisibility,
  DEFAULT_VISIBILITY_DURATION_ID,
  formatVisibilityExpiry,
  readCityVisibility,
  readVisibilityDurationId,
  visibilityDurationMs,
  type DiscoveryVisibilityState,
} from "./city-discovery-visibility.ts";

const NOW = 1_726_500_000_000;
const HOUR = 60 * 60 * 1000;
const ATL = { id: 12, name: "Atlanta" };

const off: DiscoveryVisibilityState = {
  locationMode: "city",
  cityVisibility: null,
};

test("a member who has never touched the setting is not visible to anyone", () => {
  assert.equal(off.cityVisibility, null);
  assert.equal(readCityVisibility(off.cityVisibility, NOW), null);
  assert.equal(DEFAULT_VISIBILITY_DURATION_ID, "1h");
});

test("an expired grant reads as off without anything having to run a timer", () => {
  const granted = applyCityVisibility(off, ATL, HOUR, NOW);
  assert.deepEqual(readCityVisibility(granted.cityVisibility, NOW), {
    cityId: 12,
    cityName: "Atlanta",
    expiresAt: NOW + HOUR,
  });
  // One ms before the end it is still on; at the end and after it is off, even
  // though the stored grant is byte-for-byte the same object in all three reads.
  assert.ok(readCityVisibility(granted.cityVisibility, NOW + HOUR - 1));
  assert.equal(readCityVisibility(granted.cityVisibility, NOW + HOUR), null);
  assert.equal(readCityVisibility(granted.cityVisibility, NOW + 90 * HOUR), null);
});

test("a corrupt or half-written grant fails closed instead of defaulting to visible", () => {
  for (const value of [
    undefined,
    null,
    "",
    0,
    {},
    { cityId: 12, cityName: "Atlanta" },
    { cityId: "12", cityName: "Atlanta", expiresAt: NOW + HOUR },
    { cityId: 12, cityName: "", expiresAt: NOW + HOUR },
    { cityId: Number.NaN, cityName: "Atlanta", expiresAt: NOW + HOUR },
    { cityId: 12, cityName: "Atlanta", expiresAt: Number.NaN },
  ]) {
    assert.equal(readCityVisibility(value, NOW), null);
  }
});

test("revoke clears the grant outright, so a later clock change cannot revive it", () => {
  const granted = applyCityVisibility(off, ATL, 7 * 24 * HOUR, NOW);
  const revoked = applyRevokeCityVisibility(granted);
  assert.equal(revoked.cityVisibility, null);
  assert.equal(readCityVisibility(revoked.cityVisibility, NOW), null);
  assert.equal(readCityVisibility(revoked.cityVisibility, NOW - 90 * HOUR), null);
  // Revoking is about being seen, not about finding events.
  assert.equal(revoked.locationMode, granted.locationMode);
});

test("turning on find-events never turns on visibility, in any mode", () => {
  for (const mode of ["city", "device", "hidden"] as const) {
    const next = applyFindEventsMode(off, mode);
    assert.equal(next.locationMode, mode);
    assert.equal(next.cityVisibility, null);
  }
});

test("switching find-events mode never extends or shortens a live grant", () => {
  const granted = applyCityVisibility(off, ATL, HOUR, NOW);
  const moved = applyFindEventsMode(
    applyFindEventsMode(granted, "device"),
    "hidden",
  );
  assert.deepEqual(moved.cityVisibility, granted.cityVisibility);
});

test("a grant only ever carries a city and an end time", () => {
  const granted = applyCityVisibility(off, ATL, HOUR, NOW);
  assert.deepEqual(Object.keys(granted.cityVisibility!).sort(), [
    "cityId",
    "cityName",
    "expiresAt",
  ]);
});

test("every duration is bounded and an unknown one falls back to the shortest", () => {
  assert.equal(visibilityDurationMs("1h"), HOUR);
  assert.equal(visibilityDurationMs("24h"), 24 * HOUR);
  assert.equal(visibilityDurationMs("7d"), 7 * 24 * HOUR);
  for (const value of [undefined, null, "forever", "30d", 3600]) {
    assert.equal(readVisibilityDurationId(value), "1h");
  }
});

test("the expiry line names a time today and a date when it is not today", () => {
  const sameDay = formatVisibilityExpiry(NOW + HOUR, NOW);
  assert.match(sameDay, /^\d{1,2}:\d{2}\s?(AM|PM)$/);
  const laterWeek = formatVisibilityExpiry(NOW + 7 * 24 * HOUR, NOW);
  assert.match(laterWeek, /^[A-Z][a-z]{2} \d{1,2}, \d{1,2}:\d{2}\s?(AM|PM)$/);
});
