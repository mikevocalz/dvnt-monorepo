import { test } from "node:test";
import assert from "node:assert/strict";
import { threadPageBounds, threadPageFromRows } from "./thread-pagination.ts";

test("newest bounded page reverses for display and cursor excludes equal timestamp duplicates", () => {
  const created_at = "2026-09-05T12:00:00.123456+00:00";
  const rows = [105, 104, 103, 102].map(id => ({ id, content: `message ${id}`, sender_id: 7, created_at }));
  const page = threadPageFromRows("9", rows, 7, 3, () => "now");
  assert.deepEqual(page.messages.map(m => m.id), ["103", "104", "105"]);
  assert.deepEqual(page.olderCursor, { id: "103", createdAt: created_at });
  assert.equal(threadPageBounds("9", { limit: 3, olderCursor: page.olderCursor }).filter,
    `created_at.lt.${created_at},and(created_at.eq.${created_at},id.lt.103)`);
  assert.equal(page.messages[0].sender, "user");
  assert.deepEqual(rows.map(r => r.id), [105, 104, 103, 102]);
});
test("empty and terminal pages have no older cursor; metadata stays in message position", () => {
  assert.deepEqual(threadPageFromRows("9", [], 7, 25, String), { conversationId: "9", messages: [] });
  const metadata = { mediaItems: [{ uri: "https://example.com/image.jpg", type: "image" }] };
  const page = threadPageFromRows("9", [{id: 1, content: "caption", sender_id: 8, created_at: "2026-09-05T12:00:00Z", metadata}], 7, 25, String);
  assert.equal(page.olderCursor, undefined);
  assert.deepEqual(page.messages[0].metadata, metadata);
  assert.equal(page.messages[0].sender, "other");
});
test("rejects malformed cursors, injection, and unbounded page sizes", () => {
  assert.equal(threadPageBounds("9", {}).limit, 25);
  for (const limit of [0,31,Infinity,1.5]) assert.throws(() => threadPageBounds("9", {limit}));
  assert.throws(() => threadPageBounds("9abc", {}));
  for (const createdAt of ["Yesterday", "1725537600", "2026-09-05T12:00:00Z),id.gt.0"])
    assert.throws(() => threadPageBounds("9", {olderCursor: {id: "2", createdAt}}));
});
