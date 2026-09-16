export interface FollowRelationshipRow {
  follower_id: string | number;
  following_id: string | number;
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
    isFollowing: rows.some((row) =>
      String(row.follower_id) === String(viewerId) &&
      String(row.following_id) === String(targetId)),
    followsYou: rows.some((row) =>
      String(row.follower_id) === String(targetId) &&
      String(row.following_id) === String(viewerId)),
  };
}

export function followButtonLabel(relationship: { isFollowing?: boolean; followsYou?: boolean }) {
  return relationship.isFollowing ? "Following" : relationship.followsYou ? "Follow Back" : "Follow";
}
