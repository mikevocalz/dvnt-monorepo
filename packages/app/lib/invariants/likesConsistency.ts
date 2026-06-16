/**
 * DEV-only Likes Consistency Detector
 *
 * STOP-THE-LINE: Fires if card likeCount != sheet likeCount after fetch.
 * Also detects "0-then-update" trickle-in on above-the-fold renders.
 *
 * Usage:
 *   assertLikesConsistent(postId, cardCount, sheetCount)
 *   assertNoZeroThenUpdate(postId, prevCount, nextCount)
 */

/**
 * Assert that the like count shown on a card matches the count
 * from the likes sheet/likers list for the same post.
 *
 * Fires in __DEV__ only — logs a loud console error.
 */
export function assertLikesConsistent(
  postId: string,
  cardCount: number,
  sheetCount: number,
): void {
  if (!__DEV__) return;
  if (cardCount !== sheetCount) {
    console.error(
      `[STOP-THE-LINE] Likes consistency violation for post ${postId}: ` +
        `card=${cardCount}, sheet=${sheetCount}. ` +
        `These must come from the same authority.`,
    );
  }
}

/**
 * Track per-post like count transitions.
 * Detects the "0 → N" trickle-in pattern that violates render gating rules.
 *
 * Call this in usePostLikeState or feed render when likes count changes.
 */
const likeCountHistory = new Map<string, number>();

export function assertNoZeroThenUpdate(
  postId: string,
  currentCount: number,
): void {
  if (!__DEV__) return;

  const prev = likeCountHistory.get(postId);
  likeCountHistory.set(postId, currentCount);

  // Detect: previous was 0 (default), now it's > 0 (real data arrived)
  // This means the UI showed "0 likes" then jumped to the real count
  if (prev === 0 && currentCount > 0) {
    console.error(
      `[STOP-THE-LINE] Zero-then-update detected for post ${postId}: ` +
        `0 → ${currentCount}. Above-the-fold must not render with partial data. ` +
        `Use skeleton/ScreenGate until DTO resolves.`,
    );
  }
}

/**
 * Reset tracking (call on screen unmount or user switch).
 */
export function resetLikeCountHistory(): void {
  likeCountHistory.clear();
}
