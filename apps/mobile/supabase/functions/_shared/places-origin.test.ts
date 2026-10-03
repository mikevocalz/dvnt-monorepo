import { parsePlacesOrigin, readDistanceMeters } from "./places-origin.ts";

function assertEquals(actual: unknown, expected: unknown, label: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

Deno.test("origin passes through when both coordinates are finite and in range", () => {
  assertEquals(
    parsePlacesOrigin({ latitude: 40.7128, longitude: -74.006 }),
    { latitude: 40.7128, longitude: -74.006 },
    "nyc",
  );
  assertEquals(
    parsePlacesOrigin({ latitude: -90, longitude: 180 }),
    { latitude: -90, longitude: 180 },
    "range edges",
  );
});

Deno.test("origin is ignored when missing, malformed, or out of range", () => {
  const rejected: unknown[] = [
    undefined,
    null,
    "40.7,-74.0",
    { latitude: 40.7 },
    { latitude: "40.7", longitude: "-74.0" },
    { latitude: Number.NaN, longitude: -74 },
    { latitude: 40.7, longitude: Number.POSITIVE_INFINITY },
    { latitude: 91, longitude: 0 },
    { latitude: 0, longitude: -181 },
  ];
  for (const value of rejected) {
    assertEquals(parsePlacesOrigin(value), null, JSON.stringify(value) ?? "undefined");
  }
});

Deno.test("distanceMeters passes through only as a non-negative finite number", () => {
  assertEquals(readDistanceMeters(3012), 3012, "number");
  assertEquals(readDistanceMeters(0), 0, "zero");
  assertEquals(readDistanceMeters(undefined), undefined, "missing");
  assertEquals(readDistanceMeters("3012"), undefined, "string");
  assertEquals(readDistanceMeters(-1), undefined, "negative");
});
