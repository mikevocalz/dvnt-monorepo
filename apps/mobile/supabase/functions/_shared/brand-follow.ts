/**
 * Automatic follow relationships with the canonical @DeviantEvents account.
 *
 * The member follows the brand whatever their signup date. The brand follows
 * the member back only when the profile was created inside NEW_PROFILE_WINDOW;
 * ensure_brand_follow_relationships enforces both rules and the eligibility
 * check (banned, suspended, deleted login) in SQL.
 *
 * Every path that creates a public.users row calls this: auth-sync on sign-in
 * and resolveOrProvisionUser when another function provisions a profile
 * without auth-sync. backfill_brand_follows in the brand-outbox cron catches
 * anything both miss.
 *
 * Following the brand grants nothing: no verification, role or admission state
 * reads the follows table.
 */
import { resolveBrandSender, verifyBrandSender } from "./brand-sender.ts";

export const NEW_PROFILE_WINDOW = "7 days";

export async function ensureBrandFollows(
  supabase: any,
  memberId: number,
  logTag: string,
): Promise<void> {
  if (!Number.isSafeInteger(memberId) || memberId <= 0) return;

  // Never guess the brand from @username: prove the configured
  // public.users.id + auth_id pair first.
  const configured = resolveBrandSender();
  const verified = configured.ok
    ? await verifyBrandSender(supabase, configured.sender)
    : configured;
  if (!verified.ok) {
    console.warn(`[${logTag}] brand follow skipped:`, verified.reason);
    return;
  }

  const { error } = await supabase.rpc("ensure_brand_follow_relationships", {
    p_member_id: memberId,
    p_brand_id: verified.sender.userId,
    p_bidirectional: true,
    p_lookback: NEW_PROFILE_WINDOW,
  });
  if (error) {
    console.error(`[${logTag}] brand follow failed:`, error.message);
  }
}
