import { test } from "node:test";
import assert from "node:assert/strict";
import { isOpenCohostInvitation, cohostRoomRoute, cohostActivityRoute, cohostInviteErrorMessage } from "./cohost-invite-policy.ts";
import { classifySneakyLynkError } from "./errors.ts";
const now = Date.parse("2026-11-07T12:00:00Z");
test("only open, unexpired co-host invitations are actionable", () => {
  for (const room of [null, {status:"ended"}, {status:"closed"}, {status:"open",ends_at:"2026-11-07T12:00:00Z"}, {status:"open",ends_at:"invalid"}]) assert.equal(isOpenCohostInvitation(room,now),false);
  assert.equal(isOpenCohostInvitation({status:"open",ends_at:null},now),true);
  assert.equal(isOpenCohostInvitation({status:"open",ends_at:"2026-11-07T12:01:00Z"},now),true);
});
test("acceptance routes to ordinary prejoin, never asserts device consent or video", () => {
  assert.equal(cohostRoomRoute("room-a","web"),"/feed/sneaky-lynk/room/room-a");
  assert.equal(cohostRoomRoute("room-a","native"),"/(protected)/sneaky-lynk/room/room-a");
  assert.equal(cohostRoomRoute("a?viaInvite=1","web"),"/feed/sneaky-lynk/room/a%3FviaInvite%3D1");
});
test("co-host notifications open durable decisions instead of accepting", () => {
  for (const type of ["lynk_cohost_invited","lynk_cohost_accepted","lynk_cohost_declined"]) {
    assert.equal(cohostActivityRoute(type,"native"),"/(protected)/(tabs)/activity");
    assert.equal(cohostActivityRoute(type,"web"),"/feed/activity");
  }
  assert.equal(cohostActivityRoute("room_invite","web"),null);
});
test("co-host capacity failure preserves invitation and never implies a reservation", () => {
  const text=cohostInviteErrorMessage(new Error("That Lynk is full"));
  assert.match(text,/still pending/);assert.match(text,/not reserved/);
  assert.doesNotMatch(cohostInviteErrorMessage(new Error("secret SQL exception")),/SQL/);
});
test("missing room is unavailable, not a fabricated host decision", () => {
  const result=classifySneakyLynkError("not_found","Room not found");
  assert.equal(result.reason,"not_found");assert.doesNotMatch(result.body,/host wrapped/);
});
test("typed expiry ends retry even without human-readable backend copy", () => {
  for (const reason of ["session_expired","room_ended"]) {
    const result=classifySneakyLynkError("conflict","",{reason});assert.equal(result.reason,"room_ended");assert.equal(result.ctaLabel,null);
  }
});
test("private access explains that sharing does not grant entry", () => {
  const result=classifySneakyLynkError("forbidden","",{reason:"invite_only"});assert.match(result.body,/shared link doesn't grant access/);
});
test("verification, bans and hosting blocks never claim all forbidden errors need invitations", () => {
  for (const reason of ["verification_required","profile_photo_required","member_banned","suspended","operator_denied","unknown"])
    assert.doesNotMatch(classifySneakyLynkError("forbidden","",{reason}).body,/Only invited|Ask the host to invite/);
});


test('event invitation cards follow the scheduled plan window and never revive ended rooms', () => {
  const room = { status: "open", created_at: "2026-11-05T12:00:00Z", ends_at: "2026-11-05T12:05:00Z" };
  const event = { status: "active", start_date: "2026-11-07T12:00:00Z", end_date: "2026-11-07T15:00:00Z" };
  assert.equal(isOpenCohostInvitation(room, now, event), true);
  assert.equal(isOpenCohostInvitation(room, now + 5 * 60_000, event), false);
  assert.equal(isOpenCohostInvitation({ ...room, status: "ended" }, now, event), false);
  assert.equal(isOpenCohostInvitation(room, now, { ...event, status: "cancelled" }), false);
  assert.equal(isOpenCohostInvitation(room, now, { ...event, start_date: null }), false);
  assert.equal(isOpenCohostInvitation(room, now, { ...event, end_date: "2026-11-07T11:59:00Z" }), false);
  assert.equal(isOpenCohostInvitation(room, now + 60 * 60_000, { ...event, end_date: null }), true,
    'existing six-hour no-end policy remains consistent');
});

test('event cohost refusals explain ticket and host-start requirements without granting access', () => {
  assert.match(cohostInviteErrorMessage(new Error("Waiting for the host to start")), /still pending/);
  assert.match(cohostInviteErrorMessage(new Error("An active admission ticket is required for this event")), /active admission ticket/);
  assert.match(cohostInviteErrorMessage(new Error("This event requires an invitation")), /invite your account to the event/);
});
