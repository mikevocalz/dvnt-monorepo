import test from "node:test";
import assert from "node:assert/strict";
import {
  ATTENDEE_PAGE_SIZE,
  attendeePageRequest,
  hasMoreAttendees,
  mergeAttendeePage,
  normalizeAttendeeRow,
} from "./attendee-page.ts";

test("seed of 20 under a count of 90 still has more to load", () => {
  // Event 79: get_event_attendee_avatars caps at 20, the header counts 90.
  assert.equal(hasMoreAttendees({ loaded: 20, totalCount: 90 }), true);
  const req = attendeePageRequest(20);
  assert.deepEqual(req, { limit: ATTENDEE_PAGE_SIZE, offset: 20 });
});

test("a short page ends the list even when the counter says otherwise", () => {
  // total_attendees drifts above the returnable rows (refunds, deleted users).
  assert.equal(
    hasMoreAttendees({ loaded: 30, totalCount: 90, lastPageSize: 10 }),
    false,
  );
  // A full page keeps it open.
  assert.equal(
    hasMoreAttendees({
      loaded: 44,
      totalCount: 90,
      lastPageSize: ATTENDEE_PAGE_SIZE,
    }),
    true,
  );
});

test("no count: only a full page implies another behind it", () => {
  assert.equal(hasMoreAttendees({ loaded: 0, totalCount: null }), false);
  assert.equal(hasMoreAttendees({ loaded: 24, totalCount: null }), true);
  assert.equal(hasMoreAttendees({ loaded: 25, totalCount: null }), false);
  assert.equal(hasMoreAttendees({ loaded: 20, totalCount: 20 }), false);
});

test("merge appends without duplicating ids", () => {
  const seed = [normalizeAttendeeRow({ id: "1", username: "a" }, 0)];
  const page = [
    normalizeAttendeeRow({ id: "1", username: "a" }, 0),
    normalizeAttendeeRow({ id: "2", username: "b" }, 1),
  ];
  const merged = mergeAttendeePage(seed, page);
  assert.deepEqual(merged.map((r) => r.id), ["1", "2"]);
});

test("row normalization accepts avatar/image/url and never yields an empty id", () => {
  assert.equal(normalizeAttendeeRow({ image: "i" }, 3).avatar, "i");
  assert.equal(normalizeAttendeeRow({ url: "u" }, 3).avatar, "u");
  assert.equal(normalizeAttendeeRow({ id: 7 }, 0).id, "7");
  assert.equal(normalizeAttendeeRow({ username: "zed" }, 0).id, "zed");
  assert.equal(normalizeAttendeeRow(null, 4).id, "attendee-4");
});
