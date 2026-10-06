export interface RankedScoreEntry<T> {
  value: T;
  userId: string;
  score: number;
  rank: number;
  progress: number;
  isLeader: boolean;
}

export function scoreProgress(score: number, targetScore: number): number {
  if (!Number.isFinite(score) || !Number.isFinite(targetScore) || targetScore <= 0) {
    return 0;
  }
  return Math.min(100, Math.max(0, (score / targetScore) * 100));
}

/**
 * Competition ranking: 1, 2, 2, 4. Equal scores are visually equal even
 * though the original input order remains the deterministic rendering order.
 */
export function rankScores<T>(
  rows: Array<{ value: T; userId: string; score: number }>,
  targetScore: number,
): RankedScoreEntry<T>[] {
  const sorted = rows
    .map((row, index) => ({ ...row, index }))
    .sort((a, b) => b.score - a.score || a.index - b.index);

  let lastScore: number | null = null;
  let lastRank = 0;

  return sorted.map((row, index) => {
    if (lastScore === null || row.score !== lastScore) {
      lastRank = index + 1;
      lastScore = row.score;
    }
    return {
      value: row.value,
      userId: row.userId,
      score: row.score,
      rank: lastRank,
      progress: scoreProgress(row.score, targetScore),
      isLeader: lastRank === 1,
    };
  });
}
