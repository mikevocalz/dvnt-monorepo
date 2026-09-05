/**
 * Server-side tier visibility enforcement — shared by every checkout
 * rail that inserts `ticket_holds` DIRECTLY (ticket-checkout,
 * guest-checkout, create-payment-intent, ticket-upgrade) and therefore
 * bypasses the `cart_create_hold` RPC where this logic also lives
 * (migration 20260806201000 — keep the two in sync).
 *
 * Semantics (mirror of the RPC):
 *   tier_visibility = 'hidden' → ALWAYS reject ('tier_hidden'). Hidden
 *     tiers are comps/holds, never purchasable via any checkout rail.
 *   tier_visibility = 'locked' → reject ('tier_locked') UNLESS
 *     (a) the caller submitted a code matching ticket_types.unlock_code
 *         (case-insensitive, trimmed), or
 *     (b) the tier auto-unlocks because its `unlocks_after_tier_id`
 *         gating tier is sold out.
 *
 * SECURITY: the unlock code is never echoed in any error payload or log.
 */

export type TierVisibilityError = "tier_hidden" | "tier_locked";

export interface TierVisibilityRow {
  tier_visibility?: string | null;
  unlock_code?: string | null;
  unlocks_after_tier_id?: string | null;
}

function normalizeCode(code: unknown): string {
  return typeof code === "string" ? code.trim().toLowerCase() : "";
}

/**
 * Returns null when the tier is purchasable, otherwise the rejection
 * code. `supabase` is only queried for the locked + auto-unlock case.
 */
export async function enforceTierVisibility(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  tier: TierVisibilityRow,
  submittedCode: unknown,
): Promise<TierVisibilityError | null> {
  const visibility = tier.tier_visibility || "public";
  if (visibility === "hidden") return "tier_hidden";
  if (visibility !== "locked") return null;

  // (a) submitted code matches this tier's unlock_code
  const tierCode = normalizeCode(tier.unlock_code);
  if (tierCode && normalizeCode(submittedCode) === tierCode) return null;

  // (b) auto-unlock: the gating tier is sold out. Conservative
  // approximation of ticket_type_available(gate) = 0 — counts sold
  // capacity only (active holds on the gate keep it "not sold out"
  // slightly longer than the RPC would; stricter, never looser).
  if (tier.unlocks_after_tier_id) {
    const { data: gate } = await supabase
      .from("ticket_types")
      .select("status, is_sold_out, quantity_total, quantity_sold")
      .eq("id", tier.unlocks_after_tier_id)
      .maybeSingle();
    if (
      gate &&
      (gate.status === "sold_out" ||
        gate.is_sold_out === true ||
        (gate.quantity_total != null &&
          (gate.quantity_sold ?? 0) >= gate.quantity_total))
    ) {
      return null;
    }
  }

  return "tier_locked";
}

/** Human-safe messages — must never mention or echo the code value. */
export const TIER_VISIBILITY_MESSAGES: Record<TierVisibilityError, string> = {
  tier_hidden: "This ticket tier is not available for purchase.",
  tier_locked: "This ticket tier requires a valid unlock code.",
};
