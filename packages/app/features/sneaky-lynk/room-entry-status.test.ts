import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getRoomEntryStatus } from "./room-entry-status.ts";
import { buildRoomParticipantStats, resolveRoomAudience } from "./api/room-stats.ts";

const now = Date.parse("2026-10-16T01:40:00Z");
const openRoom = { id: 592, status: "open" as const, participant_count: 1,
  created_at: "2026-10-16T01:35:50Z" };

test("open room older than the presence fallback remains joinable to a pre-join visitor", () => {
  // Service-role list can see the host; pre-join RLS cannot. This used to
  // display the same room as live in discovery and closed on the next screen.
  const visibleHost = buildRoomParticipantStats([{ room_id: 592, user_id: "host", role: "host", status: "active", joined_at: openRoom.created_at }], now);
  assert.equal(resolveRoomAudience(openRoom, visibleHost[592], now).isLive, true);
  const hiddenHosts = buildRoomParticipantStats([], now);
  const prejoin = { ...openRoom, ...resolveRoomAudience(openRoom, hiddenHosts[592], now) };
  assert.equal(prejoin.isLive, false);
  assert.equal(getRoomEntryStatus(prejoin), "prejoin");
});

test("partial membership containing only the returning visitor does not close an open room", () => {
  const stats = buildRoomParticipantStats([{ room_id: 592, user_id: "guest", role: "participant", status: "left", joined_at: openRoom.created_at }], now);
  const room = { ...openRoom, ...resolveRoomAudience(openRoom, stats[592], now) };
  assert.equal(room.isLive, false);
  assert.equal(getRoomEntryStatus(room), "prejoin");
});

test("an event waiting for its host can reach authoritative join admission", () => {
  const room = { ...openRoom, isLive: false, participant_count: 0 };
  assert.equal(getRoomEntryStatus(room), "prejoin");
});

test("an authoritative end wins over stale live presence; missing rooms stay unavailable", () => {
  const ended = { ...openRoom, status: "ended" as const, isLive: true };
  assert.equal(getRoomEntryStatus(ended), "ended");
  assert.equal(getRoomEntryStatus({ status: "closed" }), "ended");
  assert.equal(getRoomEntryStatus(null), "unavailable");
});

const native = readFileSync(new URL("../routes/screens/(protected)/sneaky-lynk/room/[id].tsx", import.meta.url), "utf8");
const web = readFileSync(new URL("./screens/room.web.tsx", import.meta.url), "utf8");

test("native and web entry use status, never presence or an event-only access probe, to close rooms", () => {
  assert.match(native, /getRoomEntryStatus\(roomLookup.room\) !== "prejoin"/);
  assert.match(native, /getRoomEntryStatus\(initialRoom\) === "ended"/);
  assert.match(native, /getRoomEntryStatus\(latestRoom\) === "ended"/);
  assert.match(web, /getRoomEntryStatus\(room\) === "ended"/);
  for (const source of [native, web]) {
    assert.doesNotMatch(source, /!\s*(?:room|initialRoom|latestRoom|roomLookup.room)\.isLive/);
    assert.doesNotMatch(source, /eventLynkApi\.wait\(id\)/);
  }
  assert.doesNotMatch(native, /updated\.is_live === false/);
  assert.match(native, /updated\.status === "ended"/);
});

test("prejoin still leads through server admission and event waiting on both platforms", () => {
  assert.match(web, /await sneakyLynkApi.joinRoom\(id, joinAnonymous\)/);
  assert.match(web, /classified.reason === "waiting_for_host"/);
  assert.match(web, /setPhase\("waiting"\)/);
  assert.match(native, /await videoRoom.join\(\)/);
  assert.match(native, /classified.reason === "waiting_for_host"/);
  assert.match(native, /setWaitingForHost\(true\)/);
});


test("an expired open snapshot offers prejoin only; server expiry remains before atomic admission", () => {
  // The client presence/deadline snapshot is not permission to mint media.
  const expired = { ...openRoom, isLive: false, endsAt: "2026-10-16T01:36:00Z" };
  assert.equal(getRoomEntryStatus(expired), "prejoin");
  const server = readFileSync(new URL("../../../../apps/mobile/supabase/functions/video_join_room/index.ts", import.meta.url), "utf8");
  const expiry = server.indexOf("Date.parse(room.ends_at) <= Date.now()");
  const admit = server.indexOf('"lynk_admit_member_atomic"');
  assert.ok(expiry >= 0 && admit > expiry);
  assert.match(server.slice(expiry, admit), /reason: "session_expired"/);
  assert.match(server, /if \(room.status !== "open"\)/);
});
