import test from "node:test";
import assert from "node:assert/strict";
import {
  saleWindowInstantToLocal,
  saleWindowLabel,
  saleWindowLocalToInstant,
} from "./sale-window.ts";

// The forms hold a sale start/end the way they hold the event start: a
// device-local Date ISO whose fields are the wall clock the organizer typed.
// "8:00 PM on Jul 10", typed on any device, for a Los Angeles event:
const typed = new Date(2026, 6, 10, 20, 0).toISOString();
const LA = "America/Los_Angeles";

test("a typed sale time is stored as that wall clock in the event's zone", () => {
  // Before: the typed value went to the server as the device's own instant,
  // so on a New York laptop this was 00:00Z (5 PM Pacific), not 03:00Z.
  assert.equal(saleWindowLocalToInstant(typed, LA), "2026-07-11T03:00:00.000Z");
  assert.equal(saleWindowLocalToInstant(typed, "Asia/Tokyo"), "2026-07-10T11:00:00.000Z");
});

test("a stored sale time reopens as the event-zone wall clock", () => {
  const local = saleWindowInstantToLocal("2026-07-11T03:00:00Z", LA);
  const d = new Date(local);
  assert.deepEqual([d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes()], [2026, 7, 10, 20, 0]);
  // Round trip is the identity.
  assert.equal(saleWindowLocalToInstant(local, LA), "2026-07-11T03:00:00.000Z");
});

test("blank and unparseable values stay empty", () => {
  assert.equal(saleWindowLocalToInstant("", LA), null);
  assert.equal(saleWindowLocalToInstant(undefined, LA), null);
  assert.equal(saleWindowLocalToInstant("not a date", LA), null);
  assert.equal(saleWindowInstantToLocal(null, LA), "");
  assert.equal(saleWindowInstantToLocal("garbage", LA), "");
});

test("an unknown zone falls back to the device zone, as the event start does", () => {
  assert.equal(saleWindowLocalToInstant(typed, "Not/AZone"), typed);
});

test("the label reads the typed wall clock with the event's zone", () => {
  assert.equal(saleWindowLabel(typed, LA), "Fri, Jul 10 at 8:00 PM PDT");
  assert.equal(saleWindowLabel("", LA), "");
});
