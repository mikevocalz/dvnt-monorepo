import test from "node:test";
import assert from "node:assert/strict";
import {
  boostDurationHours,
  computeBoostEnd,
  describeBoostWindow,
  zonedParts,
} from "./boost-schedule.ts";

const NY = "America/New_York";

test("the expensive bug: a Saturday-evening buy ends that Sunday, not eight days on", () => {
  // Saturday 2026-06-06, 21:00 EDT === Sunday 01:00 UTC.
  const start = new Date("2026-06-07T01:00:00.000Z");
  assert.equal(zonedParts(start, NY).weekday, 6, "it is Saturday in New York");
  assert.equal(zonedParts(start, "UTC").weekday, 0, "and Sunday in UTC");

  const hours = boostDurationHours(start, "weekend", NY);
  assert.ok(hours < 30, `weekend ran ${hours.toFixed(1)}h`);
  // The old UTC computation read day 0, fell through to `|| 7`, and sold ~192h.
  assert.ok(hours > 24, `weekend was cut short at ${hours.toFixed(1)}h`);
});

test("a weekend ends at midnight where the EVENT is, not where the server is", () => {
  const start = new Date("2026-06-04T16:00:00.000Z"); // Thu noon EDT
  const end = computeBoostEnd(start, "weekend", NY);
  const p = zonedParts(end, NY);
  assert.equal(p.weekday, 0, "ends on a Sunday in New York");
  assert.equal(p.hour, 23);
  assert.equal(p.minute, 59);
  // The UTC-based version put this at 23:59 UTC = 19:59 EDT, four hours early.
  assert.equal(zonedParts(end, "UTC").hour, 3, "which is past midnight in UTC");
});

test("buying on a Sunday gives that Sunday", () => {
  const start = new Date("2026-06-07T16:00:00.000Z"); // Sun noon EDT
  const end = computeBoostEnd(start, "weekend", NY);
  const p = zonedParts(end, NY);
  assert.equal(p.weekday, 0);
  assert.equal(p.day, zonedParts(start, NY).day, "the same Sunday");
  assert.ok(boostDurationHours(start, "weekend", NY) < 12);
});

test("fixed packages are exact", () => {
  const start = new Date("2026-06-04T16:00:00.000Z");
  assert.equal(boostDurationHours(start, "24h", NY), 24);
  assert.equal(boostDurationHours(start, "7d", NY), 168);
});

test("a weekend spanning the DST boundary still ends at local midnight", () => {
  // US DST ends Sunday 2026-11-01. A Thursday buy must still land on 23:59 local.
  const start = new Date("2026-10-29T16:00:00.000Z");
  const end = computeBoostEnd(start, "weekend", NY);
  const p = zonedParts(end, NY);
  assert.equal(p.weekday, 0, "Sunday");
  assert.equal(p.hour, 23);
  assert.equal(p.minute, 59);
});

test("a different zone gets a different instant for the same wall time", () => {
  const start = new Date("2026-06-04T16:00:00.000Z");
  const ny = computeBoostEnd(start, "weekend", NY);
  const la = computeBoostEnd(start, "weekend", "America/Los_Angeles");
  assert.notEqual(ny.getTime(), la.getTime());
  assert.ok(la.getTime() > ny.getTime(), "the west coast ends later");
});

test("the window is described with its timezone named", () => {
  const start = new Date("2026-06-04T16:00:00.000Z");
  const d = describeBoostWindow(start, "weekend", NY);
  assert.equal(d.timeZone, NY);
  assert.match(d.endLabel, /Sun/);
  assert.ok(d.startLabel.length > 0);
});
