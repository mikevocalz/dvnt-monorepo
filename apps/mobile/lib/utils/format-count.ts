/**
 * Format a count for display with proper English pluralization.
 *
 * Examples:
 *   formatLikeCount(0)      → "0 likes"
 *   formatLikeCount(1)      → "1 like"
 *   formatLikeCount(2)      → "2 likes"
 *   formatLikeCount(999)    → "999 likes"
 *   formatLikeCount(1000)   → "1K+ likes"
 *   formatLikeCount(1500)   → "1K+ likes"
 *   formatLikeCount(10000)  → "10K+ likes"
 *   formatLikeCount(150000) → "150K+ likes"
 *   formatLikeCount(1000000)→ "1M+ likes"
 */
export function formatLikeCount(count: number): string {
  const label = formatCount(count);
  const noun = count === 1 ? "like" : "likes";
  return `${label} ${noun}`;
}

/**
 * Format a number for compact display.
 *   0-999     → exact number
 *   1,000+    → "1K+"
 *   10,000+   → "10K+"
 *   1,000,000+→ "1M+"
 */
export function formatCount(count: number): string {
  if (count < 1000) return String(count);
  if (count < 1_000_000) return `${Math.floor(count / 1000)}K+`;
  return `${Math.floor(count / 1_000_000)}M+`;
}
