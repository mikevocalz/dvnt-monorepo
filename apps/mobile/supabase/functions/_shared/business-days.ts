/**
 * Business Day Utilities
 * Computes payout_release_at = event end_time + 5 business days (skips weekends)
 */

export function addBusinessDays(date: Date, days: number): Date {
  const result = new Date(date);
  let added = 0;
  while (added < days) {
    result.setDate(result.getDate() + 1);
    const dow = result.getDay();
    if (dow !== 0 && dow !== 6) {
      added++;
    }
  }
  return result;
}

export function computePayoutReleaseAt(endTime: string): string {
  const endDate = new Date(endTime);
  if (isNaN(endDate.getTime())) {
    throw new Error(`Invalid end_time: ${endTime}`);
  }
  return addBusinessDays(endDate, 5).toISOString();
}
