/**
 * Past Events tab rule. Run:
 *   node --test packages/app/lib/events/past-tab.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { pastTabEvents } from "./past-tab.ts";

const NOW = Date.parse("2026-10-03T12:00:00Z");
const ev = (title: string, fullDate: string, endDate: string | null = null, host = "dvnt") => ({
  title,
  fullDate,
  endDate,
  location: "DC",
  host: { username: host },
});

test("keeps events that ended weeks ago, not only the last 24 hours", () => {
  const list = [
    ev("Last month", "2026-09-01T23:00:00Z", "2026-09-02T03:00:00Z"),
    ev("Yesterday", "2026-10-02T02:00:00Z", "2026-10-02T06:00:00Z"),
  ];
  assert.deepEqual(pastTabEvents(list, "", NOW).map((e) => e.title), ["Last month", "Yesterday"]);
});

test("an event still running (no end, started 2h ago) is not past yet", () => {
  const list = [ev("Running", "2026-10-03T10:00:00Z")];
  assert.deepEqual(pastTabEvents(list, "", NOW), []);
});

test("search narrows by title, location or host", () => {
  const list = [
    ev("Kiki Ball", "2026-09-01T23:00:00Z", "2026-09-02T03:00:00Z", "micah"),
    ev("Pool Party", "2026-09-05T20:00:00Z", "2026-09-05T23:00:00Z", "deviant"),
  ];
  assert.deepEqual(pastTabEvents(list, "kiki", NOW).map((e) => e.title), ["Kiki Ball"]);
  assert.deepEqual(pastTabEvents(list, "DEVIANT", NOW).map((e) => e.title), ["Pool Party"]);
});

test("rows without a title or a start are dropped", () => {
  assert.deepEqual(pastTabEvents([ev("", "2026-09-01T23:00:00Z", "2026-09-02T03:00:00Z")], "", NOW), []);
  assert.deepEqual(pastTabEvents(null, "", NOW), []);
});
