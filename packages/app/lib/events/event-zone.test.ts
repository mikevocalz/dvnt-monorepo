/**
 * Event zone tests: wall clock typed in one zone -> stored instant, across DST,
 * and the zone-labelled display. Run:
 *   node --test packages/app/lib/events/event-zone.test.ts
 *
 * The device is pinned to New York so the "Los Angeles event created from a
 * phone in New York" case runs the same on every machine and in CI.
 */
process.env.TZ = "America/New_York";

import test from "node:test";
import assert from "node:assert/strict";
import {
  QUICK_ZONES,
  allTimeZones,
  isValidTimeZone,
  localIsoToZonedIso,
  searchTimeZones,
  zoneAbbreviation,
  zonedIsoToLocalIso,
  zonedWallClockToInstant,
} from "./event-zone.ts";
import {
  endsBeforeStart,
  formatEventClock,
  formatEventDay,
  formatEventTime,
  formatEventWhen,
} from "./event-time.ts";
import {
  buildEventInsert,
  resolveEventSchedule,
  validateEventDraft,
  END_BEFORE_START_MESSAGE,
  type EventFormDraft,
} from "../../features/events/create/event-form.ts";

const LA = "America/Los_Angeles";
const NY = "America/New_York";

/** What a picker on this (New York) device hands back for a typed wall clock. */
const typed = (y: number, mo: number, d: number, h: number, mi = 0) =>
  new Date(y, mo - 1, d, h, mi).toISOString();

test("device is pinned to New York for these tests", () => {
  assert.equal(Intl.DateTimeFormat().resolvedOptions().timeZone, NY);
});

test("wall clock in LA converts to the right instant in summer and winter", () => {
  const summer = zonedWallClockToInstant({ year: 2026, month: 7, day: 10, hour: 20, minute: 0 }, LA);
  assert.equal(summer.toISOString(), "2026-07-11T03:00:00.000Z"); // PDT, UTC-7
  const winter = zonedWallClockToInstant({ year: 2026, month: 1, day: 10, hour: 20, minute: 0 }, LA);
  assert.equal(winter.toISOString(), "2026-01-11T04:00:00.000Z"); // PST, UTC-8
});

test("spring-forward night: times on both sides of the gap, and inside it", () => {
  const wc = (hour: number, minute = 0) => ({ year: 2026, month: 3, day: 8, hour, minute });
  assert.equal(zonedWallClockToInstant(wc(1, 30), LA).toISOString(), "2026-03-08T09:30:00.000Z"); // PST
  assert.equal(zonedWallClockToInstant(wc(3, 0), LA).toISOString(), "2026-03-08T10:00:00.000Z"); // PDT
  // 2:30 AM does not exist that night; it resolves forward to 3:30 PDT.
  assert.equal(zonedWallClockToInstant(wc(2, 30), LA).toISOString(), "2026-03-08T10:30:00.000Z");
});

test("fall-back night: the repeated 1:30 AM resolves to its first (daylight) occurrence", () => {
  const t = zonedWallClockToInstant({ year: 2026, month: 11, day: 1, hour: 1, minute: 30 }, LA);
  assert.equal(t.toISOString(), "2026-11-01T08:30:00.000Z");
});

const draft = (over: Partial<EventFormDraft>): EventFormDraft => ({
  title: "Night Swim",
  description: "",
  eventDate: typed(2026, 3, 7, 22),
  endDate: null,
  eventTz: LA,
  location: "Echo Park",
  locationData: null,
  isOnline: false,
  eventType: "party",
  tags: [],
  visibility: "public",
  ageRestriction: "none",
  isNsfw: false,
  dressCode: "",
  doorPolicy: "",
  lineup: [],
  perks: [],
  disclaimers: "",
  youtubeUrl: "",
  attachLynkRoom: false,
  ticketingEnabled: false,
  ticketPrice: "",
  maxAttendees: "",
  ticketTiers: [],
  agreementAccepted: false,
  ...over,
});

test("LA event created from a New York phone stores LA wall-clock instants across DST", () => {
  // 10 PM Sat Mar 7 to 3 AM Sun Mar 8, Los Angeles. Clocks spring forward at
  // 2 AM inside the event, so the run is 4 hours, not 5.
  const d = draft({ endDate: typed(2026, 3, 8, 3) });
  const s = resolveEventSchedule(d);
  assert.equal(s.error, undefined);
  assert.equal(s.startIso, "2026-03-08T06:00:00.000Z"); // 10 PM PST
  assert.equal(s.endIso, "2026-03-08T10:00:00.000Z"); // 3 AM PDT
  const insert = buildEventInsert(d);
  assert.equal(insert.date, s.startIso);
  assert.equal(insert.endDate, s.endIso);
  assert.equal(insert.eventTz, LA);
  // And it reads back as what the organizer typed, with the venue's zone.
  assert.equal(formatEventClock(insert.date, { event_tz: LA }), "10:00 PM PST");
  assert.equal(formatEventClock(insert.endDate, { event_tz: LA }), "3:00 AM PDT");
});

test("the old path (device zone) put the same LA event 3 hours early", () => {
  // Guard on the bug itself: reading the typed wall clock in the device zone
  // stores 10 PM Eastern = 7 PM Pacific.
  const wrong = new Date(typed(2026, 3, 7, 22)).toISOString();
  assert.equal(wrong, "2026-03-08T03:00:00.000Z");
  assert.notEqual(resolveEventSchedule(draft({})).startIso, wrong);
});

test("an end that lands before the start is rejected, compared as instants", () => {
  // Typed 1 AM on the start date for a 10 PM start: ended before it began.
  const d = draft({ endDate: typed(2026, 3, 7, 1) });
  assert.equal(resolveEventSchedule(d).error, END_BEFORE_START_MESSAGE);
  assert.equal(validateEventDraft(d).errors.date, END_BEFORE_START_MESSAGE);
  // Equal start and end is rejected too.
  assert.equal(
    validateEventDraft(draft({ endDate: typed(2026, 3, 7, 22) })).errors.date,
    END_BEFORE_START_MESSAGE,
  );
});

test("drafts saved before the zone picker fall back to the device zone", () => {
  const s = resolveEventSchedule(draft({ eventTz: undefined }));
  assert.equal(s.eventTz, NY);
  assert.equal(s.startIso, "2026-03-08T03:00:00.000Z");
  assert.equal(resolveEventSchedule(draft({ eventTz: "legacy_unknown" })).eventTz, NY);
});

test("editing round-trips: stored instant -> picker value -> same instant", () => {
  // Not covered: the second 1:00-2:00 AM on a fall-back night. A wall clock
  // cannot tell the two apart, so it reopens as the first one (see above).
  for (const iso of ["2026-03-08T06:00:00.000Z", "2026-07-11T03:00:00.000Z", "2026-11-01T12:00:00.000Z"]) {
    for (const tz of [LA, NY, "Europe/London", "UTC", "Asia/Tokyo"]) {
      const picker = zonedIsoToLocalIso(iso, tz);
      assert.equal(localIsoToZonedIso(picker, tz), iso, `${iso} in ${tz}`);
    }
  }
  // The picker shows the event-zone wall clock, not the device one.
  const picker = new Date(zonedIsoToLocalIso("2026-07-11T03:00:00.000Z", LA));
  assert.equal(picker.getHours(), 20);
  assert.equal(picker.getDate(), 10);
});

test("formatting shows the zone abbreviation for a known zone", () => {
  assert.equal(formatEventClock("2026-07-11T03:00:00Z", { event_tz: LA }), "8:00 PM PDT");
  assert.equal(formatEventClock("2026-01-11T04:00:00Z", { eventTz: LA }), "8:00 PM PST");
  assert.equal(formatEventClock("2026-07-11T03:00:00Z", { event_tz: "Europe/London" }), "4:00 AM GMT+1");
  assert.equal(formatEventClock("2026-07-11T03:00:00Z", { event_tz: "UTC" }), "3:00 AM UTC");
  // The day comes from the event zone too: 8 PM Friday in LA is Saturday in NY.
  assert.equal(formatEventDay("2026-07-11T03:00:00Z", { event_tz: LA }), "Fri, Jul 10");
  assert.equal(zoneAbbreviation("2026-07-11T03:00:00Z", NY), "EDT");
});

test("unknown zone: viewer's zone, no invented label", () => {
  for (const tz of [null, undefined, "", "legacy_unknown"]) {
    const s = formatEventClock("2026-07-11T03:00:00Z", { event_tz: tz });
    assert.equal(s, "11:00 PM", `zone ${String(tz)} -> ${s}`);
    const long = formatEventTime("2026-07-11T03:00:00Z", tz, "event-local");
    assert.ok(!/UTC|GMT|[A-Z]{2}T\b/.test(long), long);
  }
});

test("online events render in the viewer's zone, labelled with it", () => {
  assert.equal(
    formatEventClock("2026-07-11T03:00:00Z", { event_tz: LA, is_online: true }),
    "11:00 PM EDT",
  );
});

test("picker offers every IANA zone, quick picks first, and search finds by city or abbreviation", () => {
  for (const z of QUICK_ZONES) assert.ok(isValidTimeZone(z.id), z.id);
  const all = allTimeZones();
  assert.ok(all.length > 400);
  assert.ok(all.every(isValidTimeZone));
  assert.ok(searchTimeZones("los angeles").includes(LA));
  assert.ok(searchTimeZones("Tokyo").includes("Asia/Tokyo"));
  assert.ok(searchTimeZones("pacific").includes(LA));
  assert.ok(searchTimeZones("pdt", 50, Date.parse("2026-07-01T00:00:00Z")).includes(LA));
  assert.equal(isValidTimeZone("Not/AZone"), false);
  assert.equal(isValidTimeZone("legacy_unknown"), false);
});

test("edit path: end before start is caught on instants; missing end is fine", () => {
  assert.equal(endsBeforeStart("2026-03-08T06:00:00Z", "2026-03-08T05:59:00Z"), true);
  assert.equal(endsBeforeStart("2026-03-08T06:00:00Z", "2026-03-08T06:00:00Z"), false);
  assert.equal(endsBeforeStart("2026-03-08T06:00:00Z", null), false);
  assert.equal(endsBeforeStart(null, "2026-03-08T06:00:00Z"), false);
});

test("checkout and ticket line reads day and time in the venue zone", () => {
  assert.equal(formatEventWhen("2026-07-11T03:00:00Z", { event_tz: LA }), "Fri, Jul 10 at 8:00 PM PDT");
  assert.equal(formatEventWhen(null, { event_tz: LA }), "");
});
