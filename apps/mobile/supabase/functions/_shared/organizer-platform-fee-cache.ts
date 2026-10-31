/** The authenticated dashboard enrolls a frozen owner/month reporting cohort.
 * SQL publishes only complete verified cohorts and retains the previous dated
 * result while a newer one verifies. No Stripe calls or financial writes here.
 * Reporting-cache enrollment is a new side effect needing release approval.
 */
import { nyMonthWindow, PLATFORM_FEE_TIME_ZONE, type PlatformFeeResult } from "./organizer-platform-fees.ts";
function exactCents(value: unknown): number {
  if (typeof value === "number") return Number.isSafeInteger(value) && value >= 0 ? value : NaN;
  if (typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value)) {
    const parsed = Number(value); return Number.isSafeInteger(parsed) ? parsed : NaN;
  }
  return NaN;
}
export async function loadCachedOrganizerPlatformFees(db: any, authId: string, _eventIds: number[], now: Date): Promise<PlatformFeeResult & {through?: string}> {
  const window = nyMonthWindow(now);
  const base = {month: window.month, timeZone: PLATFORM_FEE_TIME_ZONE};
  const unavailable = (): PlatformFeeResult => ({...base, amountCents: null, currency: null,
    status: "unavailable", reason: "verification_unavailable"});
  try {
    if (!authId) return unavailable();
    // RPC independently derives and revalidates ownership; the client cannot
    // supply payment IDs, financial amounts, or another organizer's identity.
    const {data, error} = await db.rpc("enroll_platform_fee_snapshots", {
      p_auth_id: authId, p_month_start: window.start, p_month_end: window.end,
    });
    if (error || data?.ok !== true) return unavailable();
    const report = data.report;
    if (report?.status === "pending") return {...base, amountCents:null,currency:null,status:"pending"};
    if (report?.status !== "ready") return unavailable();
    const amount = exactCents(report.amountCents);
    const through = typeof report.through === "string" ? Date.parse(report.through) : NaN;
    const verified = typeof report.asOf === "string" ? Date.parse(report.asOf) : NaN;
    const currency = report.currency;
    if (!Number.isSafeInteger(amount) || !Number.isFinite(through) || through < Date.parse(window.start)
      || through >= Date.parse(window.end) || through > now.getTime()+1000
      || !Number.isFinite(verified) || verified > now.getTime()+60_000 || verified < now.getTime()-24*60*60_000
      || !(typeof currency === "string" && /^[a-z]{3}$/.test(currency) || currency === null && amount === 0)) return unavailable();
    return {...base,amountCents:amount,currency,status:"ready",asOf:new Date(verified).toISOString(),through:new Date(through).toISOString()};
  } catch { return unavailable(); }
}
