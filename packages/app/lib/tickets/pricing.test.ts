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
