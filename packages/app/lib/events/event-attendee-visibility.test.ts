import assert from "node:assert/strict";
import test from "node:test";
import { canShowEventAttendees, isSensitiveAttendanceEvent, sanitizeEventAttendance } from "./event-attendee-visibility.ts";

test("classification recognizes only Sex Party and linked Sneaky Lynk", () => {
  for (const event of [{ event_type: "sex_party" }, { eventType: "sex_party" }, { category: "sex_party" }, { lynk_room_id: "room" }, { lynkRoomId: "room" }]) {
    assert.equal(isSensitiveAttendanceEvent(event), true);
  }
  for (const category of ["party", "virtual_session", "game_night", "pool_party", "bate_session", "kink_fetish_party", "music", "other"]) {
    assert.equal(isSensitiveAttendanceEvent({ event_type: category }), false, category);
  }
});

test("canonical values including explicit null win over stale aliases", () => {
  assert.equal(isSensitiveAttendanceEvent({ event_type: "party", category: "sex_party" }), false);
  assert.equal(isSensitiveAttendanceEvent({ event_type: null, eventType: "sex_party", category: "music" }), false);
  assert.equal(isSensitiveAttendanceEvent({ event_type: null, eventType: "party", category: "sex_party" }), true);
  assert.equal(isSensitiveAttendanceEvent({ event_type: undefined, eventType: "sex_party" }), true);
  assert.equal(isSensitiveAttendanceEvent({ lynk_room_id: null, lynkRoomId: "stale-room" }), false);
  assert.equal(isSensitiveAttendanceEvent({ lynk_room_id: "room", lynkRoomId: null }), true);
});

test("protected events default hidden and only strict organizer opt-in exposes the section", () => {
  for (const event of [{ category: "sex_party" }, { category: "party", lynkRoomId: "room" }]) {
    for (const value of [undefined, null, false, "true", 1]) {
      assert.equal(canShowEventAttendees({ ...event, showAttendees: value }), false);
      assert.equal(canShowEventAttendees({ ...event, show_attendees: value }), false);
    }
    assert.equal(canShowEventAttendees({ ...event, showAttendees: true }), true);
    assert.equal(canShowEventAttendees({ ...event, show_attendees: true }), true);
    assert.equal(canShowEventAttendees({ ...event, show_attendees: null, showAttendees: true }), false);
    assert.equal(canShowEventAttendees({ ...event, show_attendees: false, showAttendees: true }), false);
  }
});

test("ordinary events keep their existing attendee experience regardless of the new flag", () => {
  for (const category of ["party", "virtual_session", "bate_session", "kink_fetish_party", "music", "other"]) {
    for (const showAttendees of [undefined, null, false, true]) assert.equal(canShowEventAttendees({ category, showAttendees }), true);
  }
});

test("redaction strips stale profiles but preserves aggregate counts and unrelated fields", () => {
  const event = { category: "sex_party", attendees: [{ username: "private-person" }], attendeeAvatars: [{ username: "private-person" }], totalAttendees: 20, title: "Event" };
  const hidden = sanitizeEventAttendance(event);
  assert.deepEqual(hidden.attendeeAvatars, []);
  assert.equal(hidden.attendees, 20);
  assert.equal(hidden.title, "Event");
  assert.equal(sanitizeEventAttendance({ ...event, attendees: 7 }).attendees, 7);
  const ordinary = { ...event, category: "party" };
  assert.equal(sanitizeEventAttendance(ordinary), ordinary);
  const optedIn = { ...event, showAttendees: true };
  assert.equal(sanitizeEventAttendance(optedIn), optedIn);
});
