/** Published event end + six hours; missing/invalid end means six hours from now. */
export function presenceExpiry(endDate: string | null | undefined, now = Date.now()): string {
  const end = endDate ? Date.parse(endDate) : NaN;
  return new Date((Number.isFinite(end) ? end : now) + 6 * 3600_000).toISOString();
}
