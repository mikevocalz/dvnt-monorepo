import assert from "node:assert/strict";
import { test } from "node:test";
import { mergeCommentSnapshot, mergeIncomingComment, reconcilePostedComment } from "./comment-sync.ts";
import type { RoomComment } from "./comments";

function comment(id: number, changes: Partial<RoomComment> = {}): RoomComment {
  return { id, roomId: "fixture-room", authorId: "ba-host", body: "Hello", parentId: null, rootId: null, depth: 0, mentions: [], createdAt: "2026-10-13T12:00:00Z", ...changes };
}
const pending = (id: number, changes: Partial<RoomComment> = {}) => comment(id, { isOptimistic: true, ...changes });

test("an HTTP result followed by its echo renders once", () => {
  const confirmed = reconcilePostedComment([pending(-1)], -1, comment(10));
  assert.deepEqual(mergeIncomingComment(confirmed, comment(10)).map((c) => c.id), [10]);
});

test("a realtime echo followed by its HTTP result renders once", () => {
  const echoed = mergeIncomingComment([pending(-1)], comment(10));
  assert.deepEqual(echoed.map((c) => c.id), [10]);
  assert.deepEqual(reconcilePostedComment(echoed, -1, comment(10)).map((c) => c.id), [10]);
});

test("a snapshot acknowledges only one of two identical pending messages", () => {
  const merged = mergeCommentSnapshot([pending(-1), pending(-2)], [comment(10)]);
  assert.equal(merged.filter((c) => c.isOptimistic).length, 1);
  assert.equal(merged.filter((c) => !c.isOptimistic).length, 1);
  const repeated = mergeCommentSnapshot(merged, [comment(10)]);
  assert.equal(repeated.filter((c) => c.isOptimistic).length, 1);
  assert.deepEqual(mergeCommentSnapshot(repeated, [comment(10), comment(11)]).map((c) => c.id), [10, 11]);
});

test("same text from a different author, room or thread cannot consume a pending send", () => {
  for (const changes of [{ authorId: "ba-guest" }, { parentId: 20 }, { roomId: "other" }]) {
    assert.equal(mergeCommentSnapshot([pending(-1)], [comment(10, changes)]).length, 2);
  }
});

test("reconnect snapshots remove deleted messages and retain unrelated pending sends", () => {
  const merged = mergeCommentSnapshot([comment(1), comment(2), pending(-1, { body: "Still sending" })], [comment(2), comment(3)]);
  assert.deepEqual(merged.map((c) => c.id), [-1, 2, 3]);
});

test("HTTP success removes only its exact optimistic send, even for duplicate bodies", () => {
  const merged = reconcilePostedComment([pending(-1), pending(-2), comment(10)], -2, comment(10));
  assert.deepEqual(merged.map((c) => c.id), [-1, 10]);
});
