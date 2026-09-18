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

/**
 * The follow control reads as STATE, not as an instruction: "Not Following"
 * flips to "Following" when pressed. Both halves name the same thing, so the
 * button always answers the question someone actually has on a stranger's
 * profile — am I following this person — rather than telling them what the tap
 * will do.
 *
 * `followsYou` no longer changes the label. It used to produce "Follow Back",
 * which mixed a state word and an action word in one control AND was the only
 * place that relationship surfaced. It is now a separate "Follows you" marker
 * next to the name, so the signal survives a label that can no longer carry it.
 */
export function followButtonLabel(relationship: { isFollowing?: boolean }) {
  return relationship.isFollowing ? "Following" : "Not Following";
}
