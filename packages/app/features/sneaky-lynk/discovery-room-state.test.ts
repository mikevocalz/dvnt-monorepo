import test from "node:test";
import assert from "node:assert/strict";
import { discoveryRoomState } from "./discovery-room-state.ts";
const now = Date.parse("2026-11-07T00:00:00Z");
const room = { status: "open" as const, isLive: true, listeners: 10, maxParticipants: 10 };
test("confirmed live counts can describe capacity, but admission is still available", () => {
  assert.deepEqual(discoveryRoomState(room, now), { ended: false, live: true, countKnown: true, full: true, label: "Live now" });
});
test("hidden or failed presence reads never mark an open room ended or full", () => {
  for (const input of [{ ...room, isLive: false }, { ...room, presenceKnown: false }, { ...room, isLive: false, presenceKnown: false }]) {
    const state = discoveryRoomState(input, now);
    assert.equal(state.ended, false);assert.equal(state.full, false);assert.equal(state.countKnown, false);assert.equal(state.label, "Open room");
  }
});
test("only an explicit end or valid elapsed server deadline disables entry", () => {
  assert.equal(discoveryRoomState({ ...room, status: "ended" }, now).ended, true);
  assert.equal(discoveryRoomState({ ...room, endsAt: "2026-11-06T23:59:59Z" }, now).ended, true);
  assert.equal(discoveryRoomState({ ...room, endsAt: null }, now).ended, false);
  assert.equal(discoveryRoomState({ ...room, endsAt: "invalid" }, now).ended, false);
});
