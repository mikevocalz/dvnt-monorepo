/**
 * node --test packages/app/features/sneaky-lynk/api/comment-anonymity.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  broadcastSenderId,
  commentAnonymity,
  resolveCommentAuthor,
} from "./comment-anonymity.ts";
import {
  MEMBER_STAT_COLUMNS,
  buildRoomParticipantStats,
  toMemberStatRow,
} from "./room-stats.ts";

// What lynk_room_roster returns to a viewer who is "ba-me": the viewer's own
// anonymous row keeps its id, the other anonymous member is a handle.
const roster = [
  { member_id: 10, user_id: "ba-dana", is_anonymous: false, anon_label: null },
  { member_id: 11, user_id: "ba-me", is_anonymous: true, anon_label: "Anon 2" },
  { member_id: 41, user_id: "member:41", is_anonymous: true, anon_label: "Anon 3" },
];

// room_comments.author_handle as the trigger stores it: auth id for a named
// member, member:<row id> for an anonymous one.
test("a named member's message resolves to them by name", () => {
  assert.deepEqual(resolveCommentAuthor(roster, "ba-dana"), {
    authorId: "ba-dana",
    isAnonymous: false,
    anonLabel: null,
  });
});

test("the viewer's own anonymous message maps back to the viewer", () => {
  assert.deepEqual(resolveCommentAuthor(roster, "member:11"), {
    authorId: "ba-me",
    isAnonymous: true,
    anonLabel: "Anon 2",
  });
});

test("another anonymous member stays a handle with only their label", () => {
  assert.deepEqual(resolveCommentAuthor(roster, "member:41"), {
    authorId: "member:41",
    isAnonymous: true,
    anonLabel: "Anon 3",
  });
});

test("an author the roster does not place is shown as anonymous", () => {
  assert.equal(commentAnonymity(roster, "ba-sam").isAnonymous, true);
  assert.equal(commentAnonymity(roster, "member:99").isAnonymous, true);
  // A bare auth id matching the viewer's own ANONYMOUS row is not a named
  // message: named messages from that row would carry the id, anonymous ones
  // the handle, and a mismatch is resolved toward hiding.
  assert.equal(commentAnonymity(roster, "ba-me").isAnonymous, true);
});

test("without a roster nobody is shown by name", () => {
  assert.equal(commentAnonymity(null, "ba-dana").isAnonymous, true);
});

test("an anonymous member never broadcasts their auth id", () => {
  assert.equal(broadcastSenderId({ id: "ba-me", isAnonymous: true }, "t0k"), "anon:t0k");
  assert.equal(broadcastSenderId({ id: "ba-dana", isAnonymous: false }, "t0k"), "ba-dana");
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
