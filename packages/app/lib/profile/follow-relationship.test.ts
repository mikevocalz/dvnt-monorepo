import test from "node:test";
import assert from "node:assert/strict";
import { followButtonLabel, resolveFollowRelationship } from "./follow-relationship.ts";

test("an inbound follower offers Follow Back until the viewer follows them", () => {
  const incoming = { follower_id: 2, following_id: 1 };
  const relationship = resolveFollowRelationship([incoming], "1", "2");
  assert.deepEqual(relationship, { isFollowing: false, followsYou: true });
  assert.equal(followButtonLabel(relationship), "Follow Back");
  assert.equal(followButtonLabel(resolveFollowRelationship([
    incoming, { follower_id: 1, following_id: 2 },
  ], 1, 2)), "Following");
});

test("outgoing follows and unrelated accounts never imply a follow back", () => {
  assert.deepEqual(resolveFollowRelationship([{ follower_id: 1, following_id: 2 }], 1, 2),
    { isFollowing: true, followsYou: false });
  const otherViewer = resolveFollowRelationship([{ follower_id: 2, following_id: 1 }], 3, 2);
  assert.equal(followButtonLabel(otherViewer), "Follow");
  assert.equal(followButtonLabel({}), "Follow");
});

test("self and anonymous profiles have no follow relationship", () => {
  assert.deepEqual(resolveFollowRelationship([{ follower_id: 1, following_id: 1 }], 1, "1"),
    { isFollowing: false, followsYou: false });
  assert.deepEqual(resolveFollowRelationship([], null, 1), { isFollowing: false, followsYou: false });
});
