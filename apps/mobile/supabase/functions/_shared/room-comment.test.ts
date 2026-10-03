import {
  maskMentions,
  mayDeleteComment,
  parseRoomCommentRequest,
  threadPlacement,
  toClientComment,
} from "./room-comment.ts";

const ROOM = "6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

Deno.test("post requests ignore any client-supplied author", () => {
  const r = parseRoomCommentRequest({
    action: "post",
    roomId: ROOM,
    body: "  hi  ",
    authorId: "ba-someone-else",
    author_id: "ba-someone-else",
  });
  assert(r.ok, "valid post rejected");
  assert(r.value.action === "post" && r.value.body === "hi", "body not trimmed");
  assert(!("authorId" in r.value) && !("author_id" in r.value), "author id survived parsing");
});

Deno.test("post rejects bad rooms, bodies and parents", () => {
  for (const bad of [
    { roomId: "7", body: "x" },
    { roomId: ROOM, body: "   " },
    { roomId: ROOM, body: "x".repeat(2001) },
    { roomId: ROOM, body: "x", parentId: 0 },
    { roomId: ROOM, body: "x", parentId: "4" },
    { roomId: ROOM, body: "x", mentions: [{ userId: "a", username: "a", start: 0, end: 9 }] },
    { roomId: ROOM, body: "x", action: "edit" },
  ]) {
    assert(!parseRoomCommentRequest(bad).ok, `accepted ${JSON.stringify(bad)}`);
  }
});

Deno.test("delete needs a comment id", () => {
  assert(!parseRoomCommentRequest({ action: "delete", roomId: ROOM }).ok, "accepted delete without id");
  const r = parseRoomCommentRequest({ action: "delete", roomId: ROOM, commentId: 12 });
  assert(r.ok && r.value.action === "delete" && r.value.commentId === 12, "valid delete rejected");
});

Deno.test("thread placement comes from the parent row, capped at depth 2", () => {
  const top = threadPlacement(null);
  assert(top.parent_id === null && top.root_id === null && top.depth === 0, "top-level");
  const reply = threadPlacement({ id: 5, root_id: null, depth: 0 });
  assert(reply.parent_id === 5 && reply.root_id === 5 && reply.depth === 1, "reply to root");
  const deep = threadPlacement({ id: 9, root_id: 5, depth: 2 });
  assert(deep.root_id === 5 && deep.depth === 2, "depth not capped");
});

Deno.test("mentions of anonymous members carry the handle, not the auth id", () => {
  const out = maskMentions(
    [
      { userId: "ba-sam", username: "Anon 3", start: 0, end: 7 },
      { userId: "ba-dana", username: "dana", start: 8, end: 13 },
    ],
    [{ id: 41, user_id: "ba-sam" }],
  );
  assert(out[0].userId === "member:41", "anonymous mention kept the auth id");
  assert(out[1].userId === "ba-dana", "named mention changed");
});

Deno.test("client rows never carry author_id", () => {
  const row = toClientComment({
    id: 1,
    room_id: ROOM,
    author_id: "ba-sam",
    author_handle: "member:41",
    body: "hi",
    parent_id: null,
    root_id: null,
    depth: 0,
    mentions: null,
    created_at: "2026-10-03T00:00:00Z",
  });
  assert(!JSON.stringify(row).includes("ba-sam"), "author_id leaked into the response");
  assert(row.author_handle === "member:41", "handle missing");
});

Deno.test("only the author or a moderator may delete", () => {
  assert(mayDeleteComment({ actorId: "a", authorId: "a", canModerate: false }), "author refused");
  assert(mayDeleteComment({ actorId: "h", authorId: "a", canModerate: true }), "moderator refused");
  assert(!mayDeleteComment({ actorId: "b", authorId: "a", canModerate: false }), "stranger allowed");
});
