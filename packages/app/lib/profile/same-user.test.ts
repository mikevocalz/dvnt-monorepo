import test from "node:test";
import assert from "node:assert/strict";
import { isSameUser, ownsContent } from "./same-user.ts";

test("the reported bug: ownership survives a username change", () => {
  // The cached post still carries the OLD handle; the viewer has the new one.
  const viewer = { id: "42", username: "newname" } as never;
  const post = { author: { id: "42", username: "oldname" } };
  assert.equal(ownsContent(viewer, post), true, "Delete button must stay");
});

test("a stranger is never the owner", () => {
  assert.equal(
    ownsContent({ id: "42" }, { author: { id: "99" } }),
    false,
  );
});

test("missing ids on either side are not a match", () => {
  // An ownership check that returns true on missing data hands a stranger a
  // Delete button.
  assert.equal(isSameUser(null, null), false);
  assert.equal(isSameUser({ id: "42" }, null), false);
  assert.equal(isSameUser({}, {}), false);
  assert.equal(ownsContent({ id: "42" }, { author: {} }), false);
  assert.equal(ownsContent(undefined, { author: { id: "42" } }), false);
});

test("placeholder ids identify nobody", () => {
  for (const junk of ["0", 0, "null", "undefined", "", "   "]) {
    assert.equal(
      isSameUser({ id: junk as never }, { id: junk as never }),
      false,
      String(junk),
    );
  }
});

test("the three id shapes in this codebase all match each other", () => {
  // users integer id, stringified, and the Better Auth uuid.
  assert.equal(isSameUser({ id: 42 }, { id: "42" }), true);
  assert.equal(isSameUser({ id: "42" }, { userId: "42" }), true);
  assert.equal(isSameUser({ authId: "uuid-a" }, { auth_id: "uuid-a" }), true);
  assert.equal(isSameUser({ id: "42" }, { user_id: 42 }), true);
});

test("a row carrying its owner directly, with no nested author", () => {
  assert.equal(ownsContent({ id: "42" }, { userId: "42" }), true);
  assert.equal(ownsContent({ id: "42" }, { user_id: 42 }), true);
  assert.equal(ownsContent({ id: "42" }, { userId: "99" }), false);
});

test("usernames are not consulted, even when they match", () => {
  // Two different people can never be made the same by a handle collision,
  // and a matching handle must not stand in for a missing id.
  const a = { username: "same" } as never;
  const b = { username: "same" } as never;
  assert.equal(isSameUser(a, b), false);
});
