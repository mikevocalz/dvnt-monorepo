/**
 * DEV-only Relationship Consistency Detector
 *
 * STOP-THE-LINE: Fires if follow state changes post-render without
 * user action (for above-the-fold content).
 *
 * Tracks viewerFollows for each userId and alerts if it flips
 * without a mutation in between.
 */

interface RelationshipSnapshot {
  viewerFollows: boolean;
  timestamp: number;
  source: "render" | "mutation";
}

const relationshipHistory = new Map<string, RelationshipSnapshot>();

/**
 * Record a relationship state from a render pass.
 * If the state changed from the last render WITHOUT a mutation in between,
 * that means the UI showed stale data then corrected — a trickle-in violation.
 */
export function assertRelationshipStable(
  targetUserId: string,
  viewerFollows: boolean,
): void {
  if (!__DEV__) return;

  const prev = relationshipHistory.get(targetUserId);

  if (prev && prev.source === "render" && prev.viewerFollows !== viewerFollows) {
    const elapsed = Date.now() - prev.timestamp;
    // Only flag if the flip happened within 5 seconds (likely trickle-in, not user action)
    if (elapsed < 5000) {
      console.error(
        `[STOP-THE-LINE] Relationship trickle-in for user ${targetUserId}: ` +
          `viewerFollows flipped ${prev.viewerFollows} → ${viewerFollows} ` +
          `in ${elapsed}ms without user action. ` +
          `Embed viewerRelationship in the ScreenDTO.`,
      );
    }
  }

  relationshipHistory.set(targetUserId, {
    viewerFollows,
    timestamp: Date.now(),
    source: "render",
  });
}

/**
 * Record that a mutation happened for this user.
 * This suppresses the trickle-in detector for the next render.
 */
export function markRelationshipMutation(targetUserId: string): void {
  if (!__DEV__) return;

  relationshipHistory.set(targetUserId, {
    viewerFollows: relationshipHistory.get(targetUserId)?.viewerFollows ?? false,
    timestamp: Date.now(),
    source: "mutation",
  });
}

/**
 * Reset tracking (call on user switch).
 */
export function resetRelationshipHistory(): void {
  relationshipHistory.clear();
}
