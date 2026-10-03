/**
 * node --test packages/app/features/sneaky-lynk/api/comment-anonymity.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { commentAnonymity } from "./comment-anonymity.ts";
import {
  MEMBER_STAT_COLUMNS,
  buildRoomParticipantStats,
  toMemberStatRow,
} from "./room-stats.ts";

// What lynk_room_roster returns to a viewer who is "ba-me": the viewer's own
// anonymous row keeps its id, the other anonymous member is a handle.
const roster = [
  { user_id: "ba-dana", is_anonymous: false, anon_label: null },
  { user_id: "ba-me", is_anonymous: true, anon_label: "Anon 2" },
  { user_id: "member:41", is_anonymous: true, anon_label: "Anon 3" },
];

test("a named member's comment is not anonymous", () => {
  assert.deepEqual(commentAnonymity(roster, "ba-dana"), {
    isAnonymous: false,
    anonLabel: null,
  });
});

test("the viewer's own anonymous comment keeps its label", () => {
  assert.deepEqual(commentAnonymity(roster, "ba-me"), {
    isAnonymous: true,
    anonLabel: "Anon 2",
  });
});

test("an author the roster does not name is shown as anonymous", () => {
  // ba-sam is the member behind member:41. The client cannot tell which
  // label is theirs, and must not print their name.
  assert.equal(commentAnonymity(roster, "ba-sam").isAnonymous, true);
});

test("without a roster nobody is shown by name", () => {
  assert.equal(commentAnonymity(null, "ba-dana").isAnonymous, true);
});

test("presence stats never select user_id", () => {
  assert.ok(!/\buser_id\b/.test(MEMBER_STAT_COLUMNS), MEMBER_STAT_COLUMNS);
});

test("stats keyed by row id count the same people", () => {
  const now = Date.parse("2026-10-03T12:00:00Z");
  const joined = "2026-10-03T11:00:00Z";
  const rows = [
    { id: 1, room_id: 7, role: "host", status: "active", joined_at: joined, left_at: null },
    { id: 2, room_id: 7, role: "participant", status: "active", joined_at: joined, left_at: null },
    { id: 3, room_id: 7, role: "participant", status: "left", joined_at: joined, left_at: joined },
  ];
  const stats = buildRoomParticipantStats(rows.map(toMemberStatRow), now);
  assert.deepEqual(stats[7], { activeCount: 2, activeHostCount: 1, historicalCount: 3 });
});
