/**
 * Tier + add-on pricing/availability tests. Run with the repo's tsx (no new framework):
 *   node --import tsx --test packages/app/lib/tickets/pricing.test.ts
 *
 * Locks the resolution logic mirrored by the SQL functions in
 * migrations 20260613000000 / 20260613000100.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  tierAvailable,
  addonAvailable,
  resolveCurrentPriceCents,
  effectiveAddonUnitPriceCents,
  clampDonationCents,
  tierIsPurchasable,
  assertOrderWithinLimits,
  dollarsToCents,
  buildPriceSchedule,
  buildSubAllocations,
  scheduleRowsToEntries,
  bandRowsToSubAllocations,
  tierIsHiddenFromBuyers,
  tierIsLockedForBuyer,
  filterBuyerVisibleTiers,
  addonIsPurchasable,
  addonSatisfiesTierGate,
  filterEligibleAddons,
} from "./pricing";

const T = (ms: string) => Date.parse(ms);
const NOW = T("2026-06-13T12:00:00Z");

test("available = total - sold - held - reserved_comp", () => {
  assert.equal(
    tierAvailable({ price_cents: 0, quantity_total: 100, quantity_sold: 40, quantity_held: 5, quantity_reserved_comp: 10 }),
    45,
  );
  assert.equal(tierAvailable({ price_cents: 0, quantity_total: null }), 2147483647); // uncapped
  assert.equal(
    tierAvailable({ price_cents: 0, quantity_total: 10, quantity_sold: 8, quantity_held: 5 }),
    0, // never negative
  );
});

test("addon + variant availability", () => {
  assert.equal(addonAvailable({ quantity_total: 50, quantity_sold: 20, quantity_held: 5 }), 25);
  assert.equal(addonAvailable({ quantity_total: null }), 2147483647);
});

test("time-gated price_schedule: latest effective entry <= now wins", () => {
  const tier = {
    price_cents: 2000,
    quantity_total: 100,
    price_schedule: [
      { effective_at: "2026-06-01T00:00:00Z", price_cents: 2500 },
      { effective_at: "2026-06-13T00:00:00Z", price_cents: 3000 },
      { effective_at: "2026-07-01T00:00:00Z", price_cents: 4000 }, // future, ignored
    ],
  };
  assert.equal(resolveCurrentPriceCents(tier, NOW), 3000);
  // before any schedule entry → falls through to base
  assert.equal(resolveCurrentPriceCents(tier, T("2026-05-01T00:00:00Z")), 2000);
});

test("quantity-gated sub_allocations: band containing quantity_sold", () => {
  const tier = {
    price_cents: 5000,
    quantity_total: 300,
    sub_allocations: [
      { quantity: 100, price_cents: 3000 }, // first 100 @ $30 (early bird)
      { quantity: 100, price_cents: 4000 }, // next 100 @ $40
    ],
  };
  assert.equal(resolveCurrentPriceCents({ ...tier, quantity_sold: 0 }, NOW), 3000);
  assert.equal(resolveCurrentPriceCents({ ...tier, quantity_sold: 99 }, NOW), 3000);
  assert.equal(resolveCurrentPriceCents({ ...tier, quantity_sold: 100 }, NOW), 4000); // rolled
  assert.equal(resolveCurrentPriceCents({ ...tier, quantity_sold: 250 }, NOW), 5000); // past bands → base
});

test("schedule takes precedence over sub_allocations", () => {
  const tier = {
    price_cents: 5000,
    quantity_total: 300,
    quantity_sold: 0,
    price_schedule: [{ effective_at: "2026-06-01T00:00:00Z", price_cents: 9999 }],
    sub_allocations: [{ quantity: 100, price_cents: 3000 }],
  };
  assert.equal(resolveCurrentPriceCents(tier, NOW), 9999);
});

test("variant price override else add-on base", () => {
  assert.equal(effectiveAddonUnitPriceCents(2000, 2500), 2500);
  assert.equal(effectiveAddonUnitPriceCents(2000, null), 2000);
  assert.equal(effectiveAddonUnitPriceCents(2000, undefined), 2000);
});

test("donation clamps to floor; rejects bad input", () => {
  assert.equal(clampDonationCents(1000, 500), 1000); // below floor → floor
  assert.equal(clampDonationCents(1000, 5000), 5000);
  assert.equal(clampDonationCents(null, 700), 700);
  assert.throws(() => clampDonationCents(1000, -1));
  assert.throws(() => clampDonationCents(1000, 10.5));
});

test("tierIsPurchasable: status + sale window + stock", () => {
  const base = { price_cents: 1000, quantity_total: 10, quantity_sold: 0, status: "on_sale" as const };
  assert.equal(tierIsPurchasable(base, NOW), true);
  assert.equal(tierIsPurchasable({ ...base, status: "paused" }, NOW), false);
  assert.equal(tierIsPurchasable({ ...base, sale_start: "2026-07-01T00:00:00Z" }, NOW), false); // not started
  assert.equal(tierIsPurchasable({ ...base, sale_end: "2026-06-01T00:00:00Z" }, NOW), false); // ended
  assert.equal(tierIsPurchasable({ ...base, quantity_sold: 10 }, NOW), false); // sold out
});

test("assertOrderWithinLimits: per-order cap + available; lifetime cap is server-only", () => {
  const tier = { price_cents: 1000, quantity_total: 100, quantity_sold: 0, max_per_order: 4 };
  assert.equal(assertOrderWithinLimits(tier, 4), 4);
  assert.throws(() => assertOrderWithinLimits(tier, 5), /max 4 per order/);
  assert.throws(() => assertOrderWithinLimits({ ...tier, quantity_total: 2 }, 3), /only 2 left/);
  assert.throws(() => assertOrderWithinLimits(tier, 0), /positive integer/);
});

test("dollarsToCents: rounds to integer cents, null for invalid", () => {
  assert.equal(dollarsToCents("25"), 2500);
  assert.equal(dollarsToCents("19.99"), 1999);
  assert.equal(dollarsToCents("$1,250.50"), 125050);
  assert.equal(dollarsToCents(0.1 + 0.2), 30); // float noise never leaks
  assert.equal(dollarsToCents(""), null);
  assert.equal(dollarsToCents("abc"), null);
  assert.equal(dollarsToCents("-5"), null);
  assert.equal(dollarsToCents(null), null);
  assert.equal(dollarsToCents(undefined), null);
});

test("buildPriceSchedule: exact jsonb shape, ascending, invalid rows dropped", () => {
  const built = buildPriceSchedule([
    { effective_at: "2026-07-01T00:00:00Z", price_cents: 4000 },
    { effective_at: "2026-06-01T00:00:00Z", price_cents: 2500 },
    { effective_at: "not-a-date", price_cents: 9999 }, // dropped
    { effective_at: "2026-06-15T00:00:00Z", price_cents: 30.5 }, // dropped (non-int)
    { effective_at: "2026-06-20T00:00:00Z", price_cents: -1 }, // dropped (negative)
  ]);
  assert.deepEqual(built, [
    { effective_at: "2026-06-01T00:00:00.000Z", price_cents: 2500 },
    { effective_at: "2026-07-01T00:00:00.000Z", price_cents: 4000 },
  ]);
  // Round-trip: the built shape resolves exactly like the SQL mirror expects.
  assert.equal(
    resolveCurrentPriceCents(
      { price_cents: 2000, quantity_total: 100, price_schedule: built },
      NOW,
    ),
    2500,
  );
});

test("buildSubAllocations: order preserved (bands are consumed in order), invalid dropped", () => {
  const built = buildSubAllocations([
    { quantity: 100, price_cents: 3000 },
    { quantity: 0, price_cents: 1000 }, // dropped (non-positive)
    { quantity: 50, price_cents: 4000 },
    { quantity: 25, price_cents: 12.5 }, // dropped (non-int price)
  ]);
  assert.deepEqual(built, [
    { quantity: 100, price_cents: 3000 },
    { quantity: 50, price_cents: 4000 },
  ]);
  assert.equal(
    resolveCurrentPriceCents(
      { price_cents: 5000, quantity_total: 300, quantity_sold: 120, sub_allocations: built },
      NOW,
    ),
    4000,
  );
});

test("editor rows → jsonb shapes: dollar strings parsed, junk rows dropped", () => {
  assert.deepEqual(
    scheduleRowsToEntries([
      { effectiveAt: "2026-06-20T00:00:00Z", priceDollars: "30" },
      { effectiveAt: "2026-06-01T00:00:00Z", priceDollars: "25.50" },
      { effectiveAt: "", priceDollars: "40" }, // dropped (no date)
      { effectiveAt: "2026-06-10T00:00:00Z", priceDollars: "" }, // dropped (no price)
    ]),
    [
      { effective_at: "2026-06-01T00:00:00.000Z", price_cents: 2550 },
      { effective_at: "2026-06-20T00:00:00.000Z", price_cents: 3000 },
    ],
  );
  assert.deepEqual(scheduleRowsToEntries(undefined), []);

  assert.deepEqual(
    bandRowsToSubAllocations([
      { quantity: "100", priceDollars: "30" },
      { quantity: "", priceDollars: "40" }, // dropped (no N)
      { quantity: "50", priceDollars: "oops" }, // dropped (bad price)
      { quantity: "50", priceDollars: "40" },
    ]),
    [
      { quantity: 100, price_cents: 3000 },
      { quantity: 50, price_cents: 4000 },
    ],
  );
  assert.deepEqual(bandRowsToSubAllocations(null), []);
});

test("buyer visibility: hidden never renders; locked gated behind server unlock", () => {
  const tiers = [
    { id: "a", tier_visibility: "public" },
    { id: "b", tier_visibility: "hidden" },
    { id: "c", tier_visibility: "locked" },
    { id: "d" }, // legacy row without the column ⇒ public
    { id: "e", tier_visibility: null },
  ];
  assert.equal(tierIsHiddenFromBuyers(tiers[1]), true);
  assert.equal(tierIsHiddenFromBuyers(tiers[3]), false);
  assert.equal(tierIsLockedForBuyer(tiers[2]), true);
  assert.equal(tierIsLockedForBuyer(tiers[2], new Set(["c"])), false);
  assert.equal(tierIsLockedForBuyer(tiers[0], new Set()), false);

  const locked = filterBuyerVisibleTiers(tiers);
  assert.deepEqual(locked.visible.map((t) => t.id), ["a", "d", "e"]);
  assert.equal(locked.hasLockedTiers, true);

  const unlocked = filterBuyerVisibleTiers(tiers, new Set(["c"]));
  assert.deepEqual(unlocked.visible.map((t) => t.id), ["a", "c", "d", "e"]);
  assert.equal(unlocked.hasLockedTiers, false); // hidden stays hidden regardless
});

test("addonIsPurchasable: status + stock; variant-matrix rows defer to variants", () => {
  const base = { status: "on_sale", quantity_total: 20, quantity_sold: 5, quantity_held: 5 };
  assert.equal(addonIsPurchasable(base), true);
  assert.equal(addonIsPurchasable({ ...base, status: "paused" }), false);
  assert.equal(addonIsPurchasable({ ...base, status: "draft" }), false);
  assert.equal(addonIsPurchasable({ ...base, status: "ended" }), false);
  assert.equal(addonIsPurchasable({ ...base, quantity_sold: 15 }), false); // 20-15-5=0
  assert.equal(addonIsPurchasable({ status: "on_sale", quantity_total: null }), true); // uncapped
  // has_variants ⇒ add-on-level inventory is NULL by design; stock is per-variant.
  assert.equal(
    addonIsPurchasable({ status: "on_sale", quantity_total: null, has_variants: true }),
    true,
  );
});

test("addonSatisfiesTierGate: in-cart tier OR owned ticket (RPC v4 mirror)", () => {
  const gated = { requires_tier_id: "vip" };
  const open = { requires_tier_id: null };
  assert.equal(addonSatisfiesTierGate(open), true);
  assert.equal(addonSatisfiesTierGate(gated), false);
  assert.equal(addonSatisfiesTierGate(gated, new Set(["vip"])), true); // checkout path
  assert.equal(addonSatisfiesTierGate(gated, new Set(["ga"])), false);
  assert.equal(addonSatisfiesTierGate(gated, undefined, new Set(["vip"])), true); // post-purchase
  assert.equal(addonSatisfiesTierGate(gated, new Set(["ga"]), new Set(["vip"])), true);
});

test("filterEligibleAddons: on-sale, in-stock, gate-satisfied; host order preserved", () => {
  const addons = [
    { id: "coat", status: "on_sale", quantity_total: null, requires_tier_id: null },
    { id: "mg", status: "on_sale", quantity_total: 10, quantity_sold: 0, requires_tier_id: "vip" },
    { id: "tee", status: "on_sale", quantity_total: null, has_variants: true, requires_tier_id: null },
    { id: "paused", status: "paused", quantity_total: null, requires_tier_id: null },
    { id: "gone", status: "on_sale", quantity_total: 5, quantity_sold: 5, requires_tier_id: null },
  ];
  assert.deepEqual(
    filterEligibleAddons(addons, new Set(["ga"])).map((a) => a.id),
    ["coat", "tee"],
  );
  assert.deepEqual(
    filterEligibleAddons(addons, new Set(["vip"])).map((a) => a.id),
    ["coat", "mg", "tee"],
  );
  assert.deepEqual(
    filterEligibleAddons(addons, undefined, new Set(["vip"])).map((a) => a.id),
    ["coat", "mg", "tee"], // owned VIP ticket unlocks the gated add-on post-purchase
  );
});
