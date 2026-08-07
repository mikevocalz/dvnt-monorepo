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

/** ticket_types.tier_visibility CHECK values (migration 20260613000000 §6). */
export const TIER_VISIBILITIES = ["public", "hidden", "locked"] as const;
export type TierVisibility = (typeof TIER_VISIBILITIES)[number];

/** ticket_types.tier_type CHECK values (migration 20260613000000 §1). */
export const TIER_TYPES = [
  "ga",
  "vip",
  "early_bird",
  "table_service",
  "group_bundle",
  "comp",
  "donation",
] as const;
export type TierType = (typeof TIER_TYPES)[number];

/** Minimal visibility shape shared by editor rows and fetched tier records. */
export interface TierVisibilityInput {
  tier_visibility?: string | null;
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

/**
 * Parse a host-typed dollar string into integer cents. Returns null for
 * empty/invalid input — callers decide whether that means "0" or "drop the
 * row". Never returns fractional cents.
 */
export function dollarsToCents(input: string | number | null | undefined): number | null {
  if (input == null) return null;
  const n = typeof input === "number" ? input : parseFloat(String(input).replace(/[$,\s]/g, ""));
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

/**
 * Normalize editor rows into the EXACT `ticket_types.price_schedule` jsonb
 * shape consumed by `ticket_type_current_price_cents()`:
 *   [{effective_at: timestamptz, price_cents: int}] ascending by effective_at.
 * Rows with an unparseable date or a non-integer/negative price are dropped.
 */
export function buildPriceSchedule(
  rows: Array<{ effective_at: string; price_cents: number }>,
): PriceScheduleEntry[] {
  return rows
    .filter(
      (r) =>
        !!r.effective_at &&
        !Number.isNaN(Date.parse(r.effective_at)) &&
        Number.isInteger(r.price_cents) &&
        r.price_cents >= 0,
    )
    .map((r) => ({
      effective_at: new Date(r.effective_at).toISOString(),
      price_cents: r.price_cents,
    }))
    .sort((a, b) => Date.parse(a.effective_at) - Date.parse(b.effective_at));
}

/**
 * Normalize editor rows into the EXACT `ticket_types.sub_allocations` jsonb
 * shape: [{quantity: int, price_cents: int}] consumed IN ORDER against
 * quantity_sold. Row order is preserved (it is semantic — first band sells
 * first); rows with a non-positive quantity or invalid price are dropped.
 */
export function buildSubAllocations(
  rows: Array<{ quantity: number; price_cents: number }>,
): SubAllocation[] {
  return rows
    .filter(
      (r) =>
        Number.isInteger(r.quantity) &&
        r.quantity > 0 &&
        Number.isInteger(r.price_cents) &&
        r.price_cents >= 0,
    )
    .map((r) => ({ quantity: r.quantity, price_cents: r.price_cents }));
}

/**
 * Host editor rows ("price changes to $X at T") → price_schedule jsonb.
 * Rows with an empty/invalid date or dollar amount are dropped.
 */
export function scheduleRowsToEntries(
  rows: Array<{ effectiveAt: string; priceDollars: string }> | null | undefined,
): PriceScheduleEntry[] {
  return buildPriceSchedule(
    (rows ?? []).map((r) => ({
      effective_at: r.effectiveAt,
      price_cents: dollarsToCents(r.priceDollars) ?? -1, // -1 ⇒ filtered out
    })),
  );
}

/**
 * Host editor rows ("first N tickets at $X") → sub_allocations jsonb.
 * Rows with a non-positive N or an invalid dollar amount are dropped.
 */
export function bandRowsToSubAllocations(
  rows: Array<{ quantity: string; priceDollars: string }> | null | undefined,
): SubAllocation[] {
  return buildSubAllocations(
    (rows ?? []).map((r) => ({
      quantity: parseInt(r.quantity, 10),
      price_cents: dollarsToCents(r.priceDollars) ?? -1, // -1 ⇒ filtered out
    })),
  );
}

/** Hidden tiers NEVER render for buyers (missing/unknown visibility ⇒ public). */
export function tierIsHiddenFromBuyers(t: TierVisibilityInput): boolean {
  return t.tier_visibility === "hidden";
}

/** Locked tiers render only as a "Have a code?" affordance until unlocked. */
export function tierIsLockedForBuyer(
  t: TierVisibilityInput & { id?: string | number },
  unlockedTierIds?: ReadonlySet<string>,
): boolean {
  if (t.tier_visibility !== "locked") return false;
  return !(t.id != null && unlockedTierIds?.has(String(t.id)));
}

/**
 * Buyer-facing tier list: drops hidden tiers entirely, drops locked tiers the
 * buyer hasn't unlocked, and reports whether any locked tier remains so the UI
 * can show the unlock-code affordance. Unlock VALIDATION is server-side only —
 * this never compares codes.
 */
export function filterBuyerVisibleTiers<
  T extends TierVisibilityInput & { id?: string | number },
>(
  tiers: T[],
  unlockedTierIds?: ReadonlySet<string>,
): { visible: T[]; hasLockedTiers: boolean } {
  const visible = tiers.filter(
    (t) => !tierIsHiddenFromBuyers(t) && !tierIsLockedForBuyer(t, unlockedTierIds),
  );
  const hasLockedTiers = tiers.some((t) => tierIsLockedForBuyer(t, unlockedTierIds));
  return { visible, hasLockedTiers };
}

// ── Add-on availability / eligibility (client PREVIEW of the checks
//    cart_create_hold enforces under FOR UPDATE — server stays authoritative) ──

export interface AddonStatusInput extends AddonInventory {
  status?: string | null;
  has_variants?: boolean | null;
  requires_tier_id?: string | null;
}

/**
 * Is the add-on purchasable now: status on_sale + stock. When the variant
 * matrix is on (`has_variants`), the add-on row's inventory is NULL by design
 * and stock lives per-variant — pass the variant row for the real number.
 * Mirrors the `addon_not_on_sale` / `addon_insufficient_capacity` RPC checks.
 */
export function addonIsPurchasable(a: AddonStatusInput): boolean {
  if (a.status && a.status !== "on_sale") return false;
  if (a.has_variants) return true; // per-variant stock decides
  return addonAvailable(a) > 0;
}

/**
 * requires_tier_id gate, previewed client-side. Satisfied when the gating
 * tier is among the cart's selected tiers OR among tiers the buyer already
 * owns a live ticket for (post-purchase upsell — RPC v4 semantics,
 * migration 20260806400100). NULL gate ⇒ always eligible.
 */
export function addonSatisfiesTierGate(
  a: Pick<AddonStatusInput, "requires_tier_id">,
  selectedTierIds?: ReadonlySet<string>,
  ownedTierIds?: ReadonlySet<string>,
): boolean {
  if (a.requires_tier_id == null) return true;
  const gate = String(a.requires_tier_id);
  return !!(selectedTierIds?.has(gate) || ownedTierIds?.has(gate));
}

/**
 * Buyer-facing upsell list: on-sale, in-stock add-ons whose tier gate is
 * satisfied by the current selection and/or owned tickets. Order preserved
 * (host-set sort_order is semantic).
 */
export function filterEligibleAddons<T extends AddonStatusInput>(
  addons: T[],
  selectedTierIds?: ReadonlySet<string>,
  ownedTierIds?: ReadonlySet<string>,
): T[] {
  return addons.filter(
    (a) =>
      addonIsPurchasable(a) &&
      addonSatisfiesTierGate(a, selectedTierIds, ownedTierIds),
  );
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
