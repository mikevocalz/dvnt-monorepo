/**
 * Restricted profiles from guest checkout.
 *
 * Every guest rail calls one of two entry points after its tickets exist:
 *   provisionCheckoutProfile  free rails, where the fields are in the request
 *   finalizeCheckoutProfile   paid rails, where the fields waited in
 *                             checkout_profile_intake while the buyer was on
 *                             Stripe (recordCheckoutProfileIntake)
 *
 * Both are best-effort. The ticket is issued and emailed whether or not the
 * profile step works, because the buyer has paid and the ticket is the
 * contract. The SQL owns create-or-reuse, idempotency and the race handling
 * (20261003180000_checkout_restricted_profiles.sql); this file only calls it
 * and runs the onboarding hooks for a profile it just created.
 */
import type { CheckoutProfileFields } from "./checkout-profile-fields.ts";
import { resolveBrandSender, verifyBrandSender } from "./brand-sender.ts";

export interface CheckoutProfileResult {
  ok: boolean;
  status?: "created" | "reused" | "reused_legacy" | "no_intake" | "skipped";
  authId?: string | null;
  memberId?: number | null;
  username?: string;
  usernameAdjusted?: boolean;
  attached?: boolean;
  error?: string;
}

// deno-lint-ignore no-explicit-any
type Db = any;

function parse(data: unknown): CheckoutProfileResult {
  const value = typeof data === "string" ? JSON.parse(data) : data;
  return (value && typeof value === "object" ? value : { ok: false }) as CheckoutProfileResult;
}

/** Store the fields for a paid checkout until the webhook issues its tickets. */
export async function recordCheckoutProfileIntake(
  db: Db,
  checkoutRef: string,
  fields: CheckoutProfileFields,
  logPrefix: string,
): Promise<void> {
  const { error } = await db.rpc("record_checkout_profile_intake", {
    p_checkout_ref: checkoutRef,
    p_email: fields.email,
    p_username: fields.username,
    p_full_name: fields.fullName,
    p_phone_e164: fields.phoneE164,
  });
  if (error) console.error(`${logPrefix} checkout profile intake failed:`, error.message);
}

/** Free rails: create or reuse the profile now. */
export async function provisionCheckoutProfile(
  db: Db,
  fields: CheckoutProfileFields,
  logPrefix: string,
): Promise<CheckoutProfileResult> {
  try {
    const { data, error } = await db.rpc("ensure_checkout_profile", {
      p_email: fields.email,
      p_username: fields.username,
      p_full_name: fields.fullName,
      p_phone_e164: fields.phoneE164,
    });
    if (error) {
      console.error(`${logPrefix} checkout profile failed:`, error.message);
      return { ok: false, error: "rpc_failed" };
    }
    const result = parse(data);
    await onboardIfCreated(db, result, logPrefix);
    return result;
  } catch (err) {
    console.error(`${logPrefix} checkout profile threw:`, err);
    return { ok: false, error: "exception" };
  }
}

/** Paid rails: turn the stored intake into a profile. Safe to call twice. */
export async function finalizeCheckoutProfile(
  db: Db,
  checkoutRef: string,
  logPrefix: string,
): Promise<CheckoutProfileResult> {
  try {
    const { data, error } = await db.rpc("finalize_checkout_profile", {
      p_checkout_ref: checkoutRef,
    });
    if (error) {
      console.error(`${logPrefix} checkout profile finalize failed:`, error.message);
      return { ok: false, error: "rpc_failed" };
    }
    const result = parse(data) as CheckoutProfileResult & { replayed?: boolean };
    // A replay already ran the hooks the first time.
    if (!result.replayed) await onboardIfCreated(db, result, logPrefix);
    return result;
  } catch (err) {
    console.error(`${logPrefix} checkout profile finalize threw:`, err);
    return { ok: false, error: "exception" };
  }
}

/**
 * The same onboarding a signup gets: queue the welcome campaign and set up
 * the @DeviantEvents follows. The SQL wrapper skips any function that has not
 * been migrated yet, so this works with or without the onboarding branch.
 * The brand id is only passed once the configured pair is proven to be one
 * real account, exactly as auth-sync does it.
 */
async function onboardIfCreated(db: Db, result: CheckoutProfileResult, logPrefix: string) {
  if (!result.ok || result.status !== "created" || !result.authId) return;
  let brandId: number | null = null;
  const configured = resolveBrandSender();
  if (configured.ok) {
    const verified = await verifyBrandSender(db, configured.sender);
    if (verified.ok) brandId = verified.sender.userId;
  }
  const { data, error } = await db.rpc("run_new_profile_onboarding", {
    p_auth_id: result.authId,
    p_member_id: result.memberId ?? null,
    p_brand_id: brandId,
  });
  if (error) {
    console.error(`${logPrefix} profile onboarding failed:`, error.message);
    return;
  }
  const outcome = parse(data) as unknown as Record<string, string>;
  for (const [step, state] of Object.entries(outcome ?? {})) {
    if (typeof state === "string" && state.startsWith("error")) {
      console.error(`${logPrefix} profile onboarding ${step}: ${state}`);
    }
  }
}
