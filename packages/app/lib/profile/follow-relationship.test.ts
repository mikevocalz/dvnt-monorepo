import test from "node:test";
import assert from "node:assert/strict";
import {
  followButtonLabel,
  resolveFollowControl,
  resolveFollowRelationship,
} from "./follow-relationship.ts";

test("incoming-only relationship is Follow Back and keeps Follows you", () => {
  const incoming = { follower_id: 2, following_id: 1 };
  const relationship = resolveFollowRelationship([incoming], "1", "2");
  assert.deepEqual(relationship, { isFollowing: false, followsYou: true });
  assert.equal(followButtonLabel(relationship), "Follow Back");
  assert.deepEqual(resolveFollowControl({
    viewerFollowsTarget: false,
    targetFollowsViewer: true,
  }), {
    marker: "Follows you",
    buttonLabel: "Follow Back",
    action: "follow",
    accessibilityLabel: "Follow back",
  });
});

test("all four stable relationship states map to the canonical control", () => {
  assert.deepEqual(resolveFollowControl({}), {
    marker: null,
    buttonLabel: "Follow",
    action: "follow",
    accessibilityLabel: "Follow",
  });
  assert.deepEqual(resolveFollowControl({
    viewerFollowsTarget: false,
    targetFollowsViewer: true,
  }).buttonLabel, "Follow Back");
  assert.deepEqual(resolveFollowControl({
    viewerFollowsTarget: true,
    targetFollowsViewer: false,
  }), {
    marker: null,
    buttonLabel: "Following",
    action: "unfollow",
    accessibilityLabel: "Following. Double tap to unfollow",
  });
  assert.deepEqual(resolveFollowControl({
    viewerFollowsTarget: true,
    targetFollowsViewer: true,
  }), {
    marker: "Follows you",
    buttonLabel: "Following",
    action: "unfollow",
    accessibilityLabel: "Following. Double tap to unfollow",
  });
});

test("pending labels describe the in-flight action without claiming success", () => {
  assert.equal(resolveFollowControl({
    viewerFollowsTarget: false,
    targetFollowsViewer: true,
    isPending: true,
    pendingAction: "follow",
  }).buttonLabel, "Following…");

  assert.equal(resolveFollowControl({
    viewerFollowsTarget: true,
    targetFollowsViewer: true,
    isPending: true,
    pendingAction: "unfollow",
  }).buttonLabel, "Unfollowing…");
});

test("outgoing follows and unrelated accounts never imply a follow back", () => {
  assert.deepEqual(
    resolveFollowRelationship([{ follower_id: 1, following_id: 2 }], 1, 2),
    { isFollowing: true, followsYou: false },
  );
  const otherViewer = resolveFollowRelationship(
    [{ follower_id: 2, following_id: 1 }],
    3,
    2,
  );
  assert.equal(followButtonLabel(otherViewer), "Follow");
});

test("self and anonymous profiles have no follow relationship", () => {
  assert.deepEqual(
    resolveFollowRelationship([{ follower_id: 1, following_id: 1 }], 1, "1"),
    { isFollowing: false, followsYou: false },
  );
  assert.deepEqual(resolveFollowRelationship([], null, 1), {
    isFollowing: false,
    followsYou: false,
  });
});
