import test from "node:test";
import assert from "node:assert/strict";
import { followButtonLabel, resolveFollowRelationship } from "./follow-relationship.ts";

test("someone following you does not mean you follow them back", () => {
  const incoming = { follower_id: 2, following_id: 1 };
  const relationship = resolveFollowRelationship([incoming], "1", "2");
  assert.deepEqual(relationship, { isFollowing: false, followsYou: true });
  // The label reports the viewer's own state and nothing else — an inbound
  // follower is still someone the viewer is not following. That they follow
  // you is shown separately, next to the name.
  assert.equal(followButtonLabel(relationship), "Not Following");
  assert.equal(followButtonLabel(resolveFollowRelationship([
    incoming, { follower_id: 1, following_id: 2 },
  ], 1, 2)), "Following");
});

test("the label is the state, and pressing it moves to the other state", () => {
  assert.equal(followButtonLabel({ isFollowing: false }), "Not Following");
  assert.equal(followButtonLabel({ isFollowing: true }), "Following");
});

test("outgoing follows and unrelated accounts never imply a follow back", () => {
  assert.deepEqual(resolveFollowRelationship([{ follower_id: 1, following_id: 2 }], 1, 2),
    { isFollowing: true, followsYou: false });
  const otherViewer = resolveFollowRelationship([{ follower_id: 2, following_id: 1 }], 3, 2);
  assert.equal(followButtonLabel(otherViewer), "Not Following");
  // An unknown relationship is "not following", never an accidental "Following".
  assert.equal(followButtonLabel({}), "Not Following");
});

test("self and anonymous profiles have no follow relationship", () => {
  assert.deepEqual(resolveFollowRelationship([{ follower_id: 1, following_id: 1 }], 1, "1"),
    { isFollowing: false, followsYou: false });
  assert.deepEqual(resolveFollowRelationship([], null, 1), { isFollowing: false, followsYou: false });
});
