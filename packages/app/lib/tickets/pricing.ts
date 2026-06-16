/**
 * Ticket tier + add-on pricing/availability resolution — the single TS source of
 * truth used for client-side preview, MIRRORED exactly by the SQL functions
 * `public.ticket_type_current_price_cents` / `public.ticket_type_available` /
 * `public.addon_available` (migrations 20260613000000 / 20260613000100).
 *
 * Server stays authoritative (the edge function recomputes via SQL under a row
 * lock); these pure functions exist so the UI can preview the same numbers and
 * so the logic is unit-tested without a database.
 *
 * Money is cents-only, integers only.
 */

const INT_MAX = 2147483647;

export interface PriceScheduleEntry {
  effective_at: string; // ISO timestamp
  price_cents: number;
}
export interface SubAllocation {
  quantity: number;
  price_cents: number;
}

export interface TierInventory {
  price_cents: number;
  quantity_total: number | null;
  quantity_sold?: number | null;
  quantity_held?: number | null;
  quantity_reserved_comp?: number | null;
  price_schedule?: PriceScheduleEntry[] | null;
  sub_allocations?: SubAllocation[] | null;
  min_price_cents?: number | null;
}

export interface TierStatusInput extends TierInventory {
  status?: string;
  sale_start?: string | null;
  sale_end?: string | null;
  max_per_order?: number | null;
}

export interface AddonInventory {
  quantity_total: number | null;
  quantity_sold?: number | null;
  quantity_held?: number | null;
}

/** available = total − sold − held − reserved_comp (NULL total ⇒ uncapped). */
export function tierAvailable(t: TierInventory): number {
  if (t.quantity_total == null) return INT_MAX;
  return Math.max(
    0,
    t.quantity_total -
      (t.quantity_sold ?? 0) -
      (t.quantity_held ?? 0) -
      (t.quantity_reserved_comp ?? 0),
  );
}

/** available = total − sold − held (NULL total ⇒ uncapped). Add-ons + variants. */
export function addonAvailable(a: AddonInventory): number {
  if (a.quantity_total == null) return INT_MAX;
  return Math.max(0, a.quantity_total - (a.quantity_sold ?? 0) - (a.quantity_held ?? 0));
}

/**
 * Current unit price (cents). Precedence — exactly mirrors the SQL:
 *   (a) latest price_schedule entry whose effective_at <= now wins;
 *   (b) else the sub_allocation band containing quantity_sold;
 *   (c) else base price_cents.
 */
export function resolveCurrentPriceCents(t: TierInventory, nowMs: number = Date.now()): number {
  // (a) time-gated schedule
  const sched = (t.price_schedule ?? [])
    .filter((e) => Date.parse(e.effective_at) <= nowMs)
    .sort((x, y) => Date.parse(y.effective_at) - Date.parse(x.effective_at));
  if (sched.length > 0) return sched[0].price_cents;

  // (b) quantity-gated sub-allocation band
  const bands = t.sub_allocations ?? [];
  if (bands.length > 0) {
    const sold = t.quantity_sold ?? 0;
    let acc = 0;
    for (const band of bands) {
      acc += band.quantity;
      if (sold < acc) return band.price_cents;
    }
  }

  // (c) base
  return t.price_cents;
}

/** Effective add-on unit price: variant override (if non-null) else add-on base. */
export function effectiveAddonUnitPriceCents(
  addonPriceCents: number,
  variantPriceCents?: number | null,
): number {
  return variantPriceCents != null ? variantPriceCents : addonPriceCents;
}

/** Clamp a pay-what-you-want amount up to the floor; integers only. */
export function clampDonationCents(floorCents: number | null | undefined, requestedCents: number): number {
  if (!Number.isInteger(requestedCents) || requestedCents < 0) {
    throw new Error("donation amount must be a non-negative integer (cents)");
  }
  const floor = floorCents ?? 0;
  return Math.max(floor, requestedCents);
}

/** Is the tier purchasable now: status on_sale, within sale window, has stock. */
export function tierIsPurchasable(t: TierStatusInput, nowMs: number = Date.now()): boolean {
  if (t.status && t.status !== "on_sale") return false;
  if (t.sale_start && Date.parse(t.sale_start) > nowMs) return false;
  if (t.sale_end && Date.parse(t.sale_end) < nowMs) return false;
  return tierAvailable(t) > 0;
}

/**
 * Validate a requested order quantity against per-order cap + available stock.
 * Per-user LIFETIME caps (max_per_user across orders) are enforced server-side
 * only — never trust the client for those. Returns the (possibly unchanged)
 * quantity or throws with a user-facing reason.
 */
export function assertOrderWithinLimits(t: TierStatusInput, requestedQty: number): number {
  if (!Number.isInteger(requestedQty) || requestedQty <= 0) {
    throw new Error("quantity must be a positive integer");
  }
  const avail = tierAvailable(t);
  if (requestedQty > avail) {
    throw new Error(`only ${avail} left`);
  }
  if (t.max_per_order != null && requestedQty > t.max_per_order) {
    throw new Error(`max ${t.max_per_order} per order`);
  }
  return requestedQty;
}
