import test from "node:test";
import assert from "node:assert/strict";
import { metersToMiles, placeDistanceLabel } from "../proximity.ts";

const NYC = { lat: 40.7128, lng: -74.006 };

test("metersToMiles converts on the statute mile", () => {
  assert.equal(metersToMiles(1609.344), 1);
  assert.equal(metersToMiles(0), 0);
});

test("placeDistanceLabel formats Google's distanceMeters with formatMiles", () => {
  assert.equal(placeDistanceLabel(3012, NYC), "1.9 miles away");
  assert.equal(placeDistanceLabel(38_624, NYC), "24 miles away");
});

test("placeDistanceLabel floors a next-door place at 0.1 miles", () => {
  assert.equal(placeDistanceLabel(20, NYC), "0.1 miles away");
  assert.equal(placeDistanceLabel(0, NYC), "0.1 miles away");
});

test("placeDistanceLabel omits the line without a stored city", () => {
  assert.equal(placeDistanceLabel(3012, null), null);
  assert.equal(placeDistanceLabel(3012, undefined), null);
});

test("placeDistanceLabel omits the line when Google sent no distance", () => {
  assert.equal(placeDistanceLabel(undefined, NYC), null);
  assert.equal(placeDistanceLabel(null, NYC), null);
  assert.equal(placeDistanceLabel(Number.NaN, NYC), null);
  assert.equal(placeDistanceLabel(-5, NYC), null);
  // A string never reaches the formatter, even a numeric-looking one.
  assert.equal(placeDistanceLabel("3012" as unknown as number, NYC), null);
});
