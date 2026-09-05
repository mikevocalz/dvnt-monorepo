/**
 * node --test packages/app/features/video/lynk-participants.test.ts
 *
 * The peer id is the ONLY join between the Supabase roster and live MoQ media,
 * and both sides derive it independently (here and in the `lynk-moq-token`
 * edge function). Drift there is silent: every remote tile falls back to an
 * avatar with the participant looking connected-but-dead.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { mergeParticipants, peerIdForMember } from "./lynk-participants.ts";
import type { PublisherLike } from "./lynk-participants.ts";
import type { RoomMember } from "./types.ts";

const member = (over: Partial<RoomMember> = {}): RoomMember => ({
  roomId: "r1",
  userId: "usr_abc123",
  role: "speaker",
  status: "active",
  joinedAt: "2026-09-03T00:00:00Z",
  username: "dana",
  ...over,
});

const pub = (peerId: string, over: Partial<PublisherLike> = {}): PublisherLike => ({
  peerId,
  broadcast: { path: `lynk/r1/${peerId}` },
  hasVideo: true,
  hasAudio: true,
  ...over,
});

// ── peer id: mirrors peerIdFor() in the edge function ──────────────────
test("peer id is the user id when the member is not anonymous", () => {
  assert.equal(peerIdForMember("usr_abc123", null), "usr_abc123");
});

test("peer id strips characters that are not path-safe", () => {
  assert.equal(peerIdForMember("usr:ab/c 1", null), "usrabc1");
});

test("an anonymous member's peer id comes from the anon label's number", () => {
  assert.equal(peerIdForMember("usr_abc123", "Anon 7"), "anon-7");
  assert.equal(peerIdForMember("usr_abc123", "Anonymous"), "anon-0");
});

// ── merge ──────────────────────────────────────────────────────────────
test("a live publisher is joined to its member by peer id", () => {
  const [p] = mergeParticipants({
    members: [member()],
    publishers: [pub("usr_abc123")],
  });
  assert.equal(p.userId, "usr_abc123");
  assert.equal(p.username, "dana");
  assert.equal(p.isCameraOn, true);
  assert.equal(p.isMicOn, true);
  assert.deepEqual(p.broadcast, { path: "lynk/r1/usr_abc123" });
});

test("an anonymous member joins on the anon peer id, not the user id", () => {
  const [p] = mergeParticipants({
    members: [member({ isAnonymous: true, anonLabel: "Anon 3" })],
    publishers: [pub("anon-3")],
  });
  assert.ok(p.broadcast, "anonymous member should have matched its publisher");
  assert.equal(p.anonLabel, "Anon 3");
});

test("a member with no live publisher is still listed, without media", () => {
  const [p] = mergeParticipants({ members: [member()], publishers: [] });
  assert.equal(p.broadcast, undefined);
  assert.equal(p.isCameraOn, false);
  assert.equal(p.isMicOn, false);
});

test("a publisher with audio only reads as mic-on, camera-off", () => {
  const [p] = mergeParticipants({
    members: [member()],
    publishers: [pub("usr_abc123", { hasVideo: false })],
  });
  assert.equal(p.isCameraOn, false);
  assert.equal(p.isMicOn, true);
});

test("the local user is excluded — the screen renders its own preview", () => {
  const out = mergeParticipants({
    members: [member(), member({ userId: "usr_other" })],
    publishers: [],
    localUserId: "usr_abc123",
  });
  assert.deepEqual(
    out.map((p) => p.userId),
    ["usr_other"],
  );
});

test("members who left or were banned are not participants", () => {
  const out = mergeParticipants({
    members: [
      member({ userId: "u_left", status: "left" }),
      member({ userId: "u_banned", status: "banned" }),
      member(),
    ],
    publishers: [],
  });
  assert.deepEqual(
    out.map((p) => p.userId),
    ["usr_abc123"],
  );
});

test("a publisher with no matching member is dropped, not rendered nameless", () => {
  const out = mergeParticipants({
    members: [member()],
    publishers: [pub("usr_abc123"), pub("ghost-peer")],
  });
  assert.equal(out.length, 1);
});
