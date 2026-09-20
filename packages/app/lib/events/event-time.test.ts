/**
 * Timezone display + UTC time-gate tests. Run:
 *   node --import tsx --test packages/app/lib/events/event-time.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  formatEventTime,
  resolveDisplayMode,
  saleWindowOpen,
  doorsOpen,
  isLive,
  isPast,
  eventEndAt,
  eventEnded,
  eventSalesClosed,
  SALES_CUTOFF_MINUTES,
} from "./event-time.ts";

// LA event: absolute instant 04:00Z, venue zone America/Los_Angeles (summer → PDT).
const LA_SUMMER = "2026-07-08T04:00:00Z";
// Winter instant for DST coverage (standard time → PST/EST).
const LA_WINTER = "2026-01-08T04:00:00Z";

test("event-local: LA event shows the venue time+zone regardless of viewer", () => {
  const s = formatEventTime(LA_SUMMER, "America/Los_Angeles", "event-local");
  assert.ok(s.includes("9:00 PM"), s);
  assert.ok(s.includes("PDT"), s);
});

test("viewer-local: same instant renders in the NY viewer's zone", () => {
  const s = formatEventTime(
    LA_SUMMER,
    "America/Los_Angeles",
    "viewer-local",
    "America/New_York",
  );
  assert.ok(s.includes("12:00 AM"), s);
  assert.ok(s.includes("EDT"), s);
});

test("event-local is identical for LA, NY, London viewers (venue zone wins)", () => {
  // event-local ignores the viewer entirely — one door time for everyone.
  const a = formatEventTime(LA_SUMMER, "America/Los_Angeles", "event-local", "America/Los_Angeles");
  const b = formatEventTime(LA_SUMMER, "America/Los_Angeles", "event-local", "America/New_York");
  const c = formatEventTime(LA_SUMMER, "America/Los_Angeles", "event-local", "Europe/London");
  assert.equal(a, b);
  assert.equal(b, c);
  assert.ok(a.includes("9:00 PM PDT"), a);
});

test("DST: winter instant uses standard-time offsets (PST / EST)", () => {
  const la = formatEventTime(LA_WINTER, "America/Los_Angeles", "event-local");
  assert.ok(la.includes("8:00 PM"), la); // 04:00Z - 8h
  assert.ok(la.includes("PST"), la);
  const ny = formatEventTime(LA_WINTER, "America/Los_Angeles", "viewer-local", "America/New_York");
  assert.ok(ny.includes("11:00 PM"), ny); // 04:00Z - 5h
  assert.ok(ny.includes("EST"), ny);
});

test("resolveDisplayMode: streamed → viewer-local, physical → event-local", () => {
  assert.equal(resolveDisplayMode({ is_online: true }), "viewer-local");
  assert.equal(resolveDisplayMode({ is_online: false }), "event-local");
  assert.equal(resolveDisplayMode({ isOnline: true }), "viewer-local");
  assert.equal(resolveDisplayMode({}), "event-local");
});

test("time gates operate on the UTC instant (viewer/server tz irrelevant)", () => {
  const start = Date.parse("2026-07-08T04:00:00Z");
  const end = start + 3 * 3600_000; // 3h event
  assert.equal(isLive(start, end, start + 3600_000), true); // 1h in
  assert.equal(isLive(start, end, start - 1), false); // just before
  assert.equal(isPast(start, end, end + 1), true);
  assert.equal(isPast(start, end, end - 1), false);
  assert.equal(doorsOpen(start, end, start - 1000, 2000), true); // within 2s lead
  assert.equal(doorsOpen(start, end, start - 5000, 2000), false);
  assert.equal(saleWindowOpen(start, end, start + 1), true);
  assert.equal(saleWindowOpen(start, end, end), false); // closed at end
  assert.equal(saleWindowOpen(null, null, Date.now()), true); // unbounded
});

test("eventEndAt: anchor chain mirrors the server — end → start/fullDate → date", () => {
  const end = "2026-09-21T07:00:00Z";
  const start = "2026-09-21T02:00:00Z";
  // endDate wins over start; camelCase and snake_case both read.
  assert.equal(eventEndAt({ endDate: end, fullDate: start }), Date.parse(end));
  assert.equal(eventEndAt({ end_date: end, start_date: start }), Date.parse(end));
  // No end → anchors on start (fullDate is the card's start stamp).
  assert.equal(eventEndAt({ fullDate: start }), Date.parse(start));
  assert.equal(eventEndAt({ start_date: start }), Date.parse(start));
  // ISO `date` is the last resort; day-of-month chips are NOT dates.
  assert.equal(eventEndAt({ date: end }), Date.parse(end));
  assert.equal(eventEndAt({ date: "05" }), null);
  assert.equal(eventEndAt({ date: "--" }), null);
  assert.equal(eventEndAt({}), null);
  assert.equal(eventEndAt(null), null);
});

test("eventEnded / eventSalesClosed: cutoff is end anchor − 30 min", () => {
  const end = Date.parse("2026-09-21T07:00:00Z");
  const ev = { endDate: "2026-09-21T07:00:00Z" };
  const cutoff = end - SALES_CUTOFF_MINUTES * 60_000;
  assert.equal(eventEnded(ev, end - 1), false);
  assert.equal(eventEnded(ev, end), true);
  // Sales close 30 min BEFORE end — the CTA dies while the event runs.
  assert.equal(eventSalesClosed(ev, cutoff - 1), false);
  assert.equal(eventSalesClosed(ev, cutoff), true);
  assert.equal(eventSalesClosed(ev, end - 1), true);
  // No anchor → stays open (mirrors isSalesClosed).
  assert.equal(eventSalesClosed({}, end + 999_000), false);
  assert.equal(eventEnded({}, end + 999_000), false);
});
