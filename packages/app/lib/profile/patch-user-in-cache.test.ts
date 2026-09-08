import test from "node:test";
import assert from "node:assert/strict";
import {
  displayablePatch,
  patchUserInTree,
} from "./patch-user-in-cache.ts";

const ME = "42";
const patch = { username: "newname", handle: "newname" };

test("patches an author nested inside an infinite feed, which the old list missed", () => {
  const cache = {
    pageParams: [null],
    pages: [
      {
        posts: [
          { id: "p1", userId: ME, author: { id: ME, username: "oldname" } },
          { id: "p2", userId: "99", author: { id: "99", username: "someone" } },
        ],
      },
    ],
  };
  const out = patchUserInTree(cache, ME, patch);
  assert.equal(out.pages[0].posts[0].author.username, "newname");
  assert.equal(out.pages[0].posts[1].author.username, "someone");
});

test("patches caches nobody enumerated: comments, likers, search, messages", () => {
  const shapes = [
    { comments: [{ id: "c1", user: { id: ME, username: "oldname" } }] },
    { likers: [{ id: ME, username: "oldname" }] },
    { results: { users: [{ id: ME, username: "oldname" }] } },
    { threads: [{ participants: [{ id: ME, username: "oldname" }] }] },
    [{ story: { owner: { id: ME, username: "oldname" } } }],
  ];
  for (const shape of shapes) {
    const out = patchUserInTree(shape, ME, patch);
    assert.equal(
      JSON.stringify(out).includes("oldname"),
      false,
      `stale username survived in ${JSON.stringify(shape)}`,
    );
  }
});

test("a post that BELONGS to the user is not itself rewritten", () => {
  const cache = { id: "p1", userId: ME, caption: "hi", username: undefined };
  const out = patchUserInTree(cache, ME, patch);
  // The post has no username field to update; nothing is invented.
  assert.equal(out.username, undefined);
  assert.equal(out.caption, "hi");
});

test("a field the node does not have is never added", () => {
  const cache = { id: ME, username: "oldname" };
  const out = patchUserInTree(cache, ME, { username: "newname", avatar: "x" });
  assert.equal(out.username, "newname");
  assert.equal("avatar" in out, false, "avatar was invented");
});

test("an unchanged cache keeps its identity so React does not re-render it", () => {
  const cache = { pages: [{ posts: [{ id: "p1", author: { id: "99", username: "other" } }] }] };
  const out = patchUserInTree(cache, ME, patch);
  assert.equal(out, cache, "a new object was returned for an untouched cache");
});

test("a changed cache returns new objects only along the changed path", () => {
  const untouched = { id: "99", username: "other" };
  const cache = { a: untouched, b: { id: ME, username: "oldname" } };
  const out = patchUserInTree(cache, ME, patch);
  assert.notEqual(out, cache);
  assert.equal(out.a, untouched, "the untouched branch was copied needlessly");
  assert.equal(out.b.username, "newname");
});

test("numeric and string ids match each other", () => {
  const cache = { author: { id: 42, username: "oldname" } };
  const out = patchUserInTree(cache, ME, patch);
  assert.equal(out.author.username, "newname");
});

test("a cyclic cache terminates", () => {
  const node: Record<string, unknown> = { id: ME, username: "oldname" };
  node.self = node;
  const wrapper = { node };
  const out = patchUserInTree(wrapper, ME, patch);
  assert.equal((out.node as Record<string, unknown>).username, "newname");
});

test("snake_case author ids are recognised", () => {
  const cache = { post: { id: "p1", user_id: ME, user: { user_id: ME, username: "oldname" } } };
  const out = patchUserInTree(cache, ME, patch);
  assert.equal(JSON.stringify(out).includes("oldname"), false);
});

test("the displayable patch carries only what changed", () => {
  assert.deepEqual(displayablePatch({ username: "a" }), {
    username: "a",
    handle: "a",
  });
  assert.deepEqual(displayablePatch({}), {});
  const full = displayablePatch({ username: "a", name: "A", avatar: "u", isVerified: true });
  assert.equal(full.verified, true);
  assert.equal(full.name, "A");
});

test("an empty patch or missing user id is a no-op", () => {
  const cache = { id: ME, username: "oldname" };
  assert.equal(patchUserInTree(cache, ME, {}), cache);
  assert.equal(patchUserInTree(cache, "", patch), cache);
});
