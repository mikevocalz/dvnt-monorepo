export function normalizeEngagementCount(count: number): number {
  return Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
}

/** Short visible count; accessibility labels retain the exact total. */
export function formatEngagementCount(count: number): string {
  const value = normalizeEngagementCount(count);
  if (value >= 1_000_000) return `${Math.floor(value / 100_000) / 10}M`;
  if (value >= 1_000) return `${Math.floor(value / 100) / 10}K`;
  return String(value);
}
