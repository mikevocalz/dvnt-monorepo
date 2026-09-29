import test from "node:test";
import assert from "node:assert/strict";
import {
  distanceMiles,
  formatMiles,
  matchCity,
  proximityLabel,
  resolveViewerPosition,
} from "./proximity.ts";

const CITIES = [
  { name: "New York", lat: 40.7128, lng: -74.006 },
  { name: "Brooklyn", lat: 40.6782, lng: -73.9442 },
  { name: "Atlanta", lat: 33.749, lng: -84.388 },
  { name: "Washington", lat: 38.9072, lng: -77.0369 },
  { name: "Los Angeles", lat: 34.0522, lng: -118.2437 },
];

test("matchCity resolves a plain city name", () => {
  assert.equal(matchCity("New York", CITIES)?.name, "New York");
});

test("matchCity strips the state suffix after a comma", () => {
  assert.equal(matchCity("Atlanta, GA", CITIES)?.name, "Atlanta");
  assert.equal(matchCity("brooklyn, NY", CITIES)?.name, "Brooklyn");
});

test("matchCity tolerates punctuation in D.C.-style input", () => {
  assert.equal(matchCity("Washington D.C.", CITIES)?.name, "Washington");
});

test("matchCity refuses slang, states, and blanks instead of guessing", () => {
  assert.equal(matchCity("HTX", CITIES), undefined);
  assert.equal(matchCity("Louisiana", CITIES), undefined);
  assert.equal(matchCity("", CITIES), undefined);
  assert.equal(matchCity(null, CITIES), undefined);
});

test("a city name does not prefix-match into a different city", () => {
  // "New" alone must not reach "New York"; "Los" must not reach "Los Angeles".
  assert.equal(matchCity("New", CITIES), undefined);
  assert.equal(matchCity("Los", CITIES), undefined);
});

test("distanceMiles is sane for a known leg", () => {
  // NYC centroid to LA centroid is about 2450 miles.
  const mi = distanceMiles(40.7128, -74.006, 34.0522, -118.2437);
  assert.ok(mi > 2400 && mi < 2500, `got ${mi}`);
});

test("formatMiles keeps one decimal under ten, rounds above", () => {
  assert.equal(formatMiles(0.14), "0.1 miles away");
  assert.equal(formatMiles(5.44), "5.4 miles away");
  assert.equal(formatMiles(23.7), "24 miles away");
});

test("same named city collapses to In, not a fake-precise figure", () => {
  const label = proximityLabel(
    { lat: 40.6, lng: -73.9, cityName: "New York" },
    CITIES[0],
  );
  assert.equal(label, "In New York");
});

test("different named cities show the centroid distance", () => {
  const label = proximityLabel(
    { lat: 40.6, lng: -73.9, cityName: "New York" },
    CITIES[1], // Brooklyn centroid is only a few miles from the NY centroid.
  );
  assert.match(label, /miles away$/);
});

test("viewer without a named city still gets a distance", () => {
  const label = proximityLabel(
    { lat: 33.75, lng: -84.39 },
    CITIES[2], // Atlanta, ~0mi from the viewer
  );
  assert.equal(label, "In Atlanta");
});

test("resolveViewerPosition prefers a device fix over the picked city", () => {
  const pos = resolveViewerPosition({
    deviceLat: 1,
    deviceLng: 2,
    activeCity: CITIES[0],
    viewerLocationText: "Atlanta, GA",
    cities: CITIES,
  });
  assert.deepEqual(pos, { lat: 1, lng: 2 });
});

test("resolveViewerPosition falls back to activeCity then own location text", () => {
  const fromCity = resolveViewerPosition({
    activeCity: CITIES[0],
    cities: CITIES,
  });
  assert.equal(fromCity?.cityName, "New York");

  const fromText = resolveViewerPosition({
    viewerLocationText: "Atlanta, GA",
    cities: CITIES,
  });
  assert.equal(fromText?.cityName, "Atlanta");

  assert.equal(resolveViewerPosition({ cities: CITIES }), null);
  // A zero fix is not a fix — Null Island would poison every distance.
  assert.equal(
    resolveViewerPosition({ deviceLat: 0, deviceLng: 0, cities: CITIES }),
    null,
  );
});
