export interface FollowRelationshipRow {
  follower_id: string | number;
  following_id: string | number;
}

export type FollowMutationAction = "follow" | "unfollow";

export interface FollowControlState {
  marker: "Follows you" | null;
  buttonLabel: "Follow" | "Follow Back" | "Following" | "Following…" | "Unfollowing…";
  action: FollowMutationAction;
  accessibilityLabel: string;
}

/** Relationships are directional: following someone does not mean they follow you. */
export function resolveFollowRelationship(
  rows: readonly FollowRelationshipRow[],
  viewerId: string | number | null | undefined,
  targetId: string | number | null | undefined,
) {
  if (!viewerId || !targetId || String(viewerId) === String(targetId)) {
    return { isFollowing: false, followsYou: false };
  }
  return {
    isFollowing: rows.some(
      (row) =>
        String(row.follower_id) === String(viewerId) &&
        String(row.following_id) === String(targetId),
    ),
    followsYou: rows.some(
      (row) =>
        String(row.follower_id) === String(targetId) &&
        String(row.following_id) === String(viewerId),
    ),
  };
}

/**
 * Canonical follow-control semantics shared by profile detail and member lists.
 *
 * "Follows you" stays a descriptive relationship marker. "Follow Back" is the
 * action when that incoming relationship exists and the viewer has not yet
 * reciprocated. Pending labels describe the mutation in progress without
 * announcing success before the server responds.
 */
export function resolveFollowControl(input: {
  viewerFollowsTarget?: boolean;
  targetFollowsViewer?: boolean;
  isPending?: boolean;
  pendingAction?: FollowMutationAction | null;
}): FollowControlState {
  const viewerFollowsTarget = input.viewerFollowsTarget === true;
  const targetFollowsViewer = input.targetFollowsViewer === true;
  const action: FollowMutationAction = viewerFollowsTarget ? "unfollow" : "follow";

  if (input.isPending) {
    const pendingAction = input.pendingAction ?? action;
    return {
      marker: targetFollowsViewer ? "Follows you" : null,
      buttonLabel: pendingAction === "follow" ? "Following…" : "Unfollowing…",
      action,
      accessibilityLabel:
        pendingAction === "follow"
          ? "Following this member"
          : "Unfollowing this member",
    };
  }

  if (viewerFollowsTarget) {
    return {
      marker: targetFollowsViewer ? "Follows you" : null,
      buttonLabel: "Following",
      action: "unfollow",
      accessibilityLabel: "Following. Double tap to unfollow",
    };
  }

  if (targetFollowsViewer) {
    return {
      marker: "Follows you",
      buttonLabel: "Follow Back",
      action: "follow",
      accessibilityLabel: "Follow back",
    };
  }

  return {
    marker: null,
    buttonLabel: "Follow",
    action: "follow",
    accessibilityLabel: "Follow",
  };
}

/** Backward-compatible label helper for call sites that only need copy. */
export function followButtonLabel(relationship: {
  isFollowing?: boolean;
  followsYou?: boolean;
}) {
  return resolveFollowControl({
    viewerFollowsTarget: relationship.isFollowing,
    targetFollowsViewer: relationship.followsYou,
  }).buttonLabel;
}
