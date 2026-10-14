import test from "node:test";
import assert from "node:assert/strict";
import { resolveGuestPurchase, type GuestPurchaseTier } from "./guest-purchase-state.ts";

const free: GuestPurchaseTier = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Free admission",
  price_cents: 0,
  quantity_total: 20,
  quantity_sold: 0,
  is_active: true,
  status: "on_sale",
};
const paid: GuestPurchaseTier = {
  ...free,
  id: "22222222-2222-4222-8222-222222222222",
  name: "General admission",
  price_cents: 2500,
};
const input = {
  event: { price: 25, ticketingEnabled: true, ticketTiers: [free, paid] },
  eventPending: false,
  eventError: false,
  tiers: [free, paid],
  tiersPending: false,
  tiersError: false,
};

test("slow ticket loading never turns absent rows into checkout or RSVP", () => {
  for (const price of [0, 25]) {
    const result = resolveGuestPurchase({
      ...input,
      event: { price, ticketingEnabled: false },
      tiers: undefined,
      tiersPending: true,
    });
    assert.equal(result.kind, "loading");
  }
});

test("failed tier reads remain retryable, even with stale cached rows", () => {
  for (const tiers of [undefined, [], [paid]]) {
    assert.equal(resolveGuestPurchase({ ...input, tiers, tiersError: true }).kind, "error");
  }
  assert.equal(resolveGuestPurchase({ ...input, tiersError: true, tiersPending: true }).kind, "loading");
});

test("guest purchase requires the full event, never a list display fallback", () => {
  assert.equal(resolveGuestPurchase({ ...input, event: undefined, eventPending: true }).kind, "loading");
  assert.equal(resolveGuestPurchase({ ...input, event: null }).kind, "unavailable");
  assert.equal(resolveGuestPurchase({ ...input, eventError: true }).kind, "error");
});

test("paid or ticketing-enabled events without live tiers stay unavailable", () => {
  for (const event of [
    { price: 25, ticketingEnabled: true },
    { price: 0, ticketingEnabled: true },
    { price: 0 },
    { price: 0, ticketingEnabled: false, ticketTiers: [free] },
  ]) {
    assert.equal(resolveGuestPurchase({ ...input, event, tiers: [] }).kind, "unavailable");
  }
});

test("only confirmed tier-less free events enter the guest RSVP rail", () => {
  assert.equal(resolveGuestPurchase({
    ...input,
    event: { price: 0, ticketingEnabled: false, ticketTiers: [] },
    tiers: [],
  }).kind, "rsvp");
});

test("mixed tiers default to a paid row but explicitly selecting free still uses ticket checkout", () => {
  const defaultPurchase = resolveGuestPurchase(input);
  assert.equal(defaultPurchase.kind, "checkout");
  if (defaultPurchase.kind === "checkout") assert.equal(defaultPurchase.tier, paid);

  const freePurchase = resolveGuestPurchase({ ...input, selectedTierId: free.id });
  assert.equal(freePurchase.kind, "checkout");
  if (freePurchase.kind === "checkout") {
    assert.equal(freePurchase.tier, free);
    assert.equal(freePurchase.tier.price_cents, 0);
  }
});

test("a display-only tier ID cannot supply checkout identity or price", () => {
  const event = { ...input.event, ticketTiers: [{ id: "display-fallback", price_cents: 1 }] };
  assert.equal(resolveGuestPurchase({ ...input, event, selectedTierId: "display-fallback" }).kind, "unavailable");
  const result = resolveGuestPurchase({ ...input, event, selectedTierId: paid.id });
  assert.equal(result.kind, "checkout");
  if (result.kind === "checkout") {
    assert.equal(result.tier.id, paid.id);
    assert.equal(result.tier.price_cents, 2500);
  }
});

test("hidden, locked, inactive, paused and sold-out tiers are not a free RSVP", () => {
  for (const tier of [
    { ...free, tier_visibility: "hidden" },
    { ...free, tier_visibility: "locked" },
    { ...free, is_active: false },
    { ...free, status: "paused" },
    { ...free, quantity_sold: 20 },
    { ...free, quantity_held: 20 },
    { ...free, sale_start: "2099-01-01T00:00:00Z" },
    { ...free, sale_end: "2000-01-01T00:00:00Z" },
  ]) {
    assert.equal(resolveGuestPurchase({
      ...input,
      event: { price: 0, ticketingEnabled: false },
      tiers: [tier],
    }).kind, "unavailable");
  }
  assert.equal(resolveGuestPurchase({
    ...input,
    tiers: [{ ...paid, tier_visibility: "locked" }],
    unlockedTierIds: new Set([paid.id]),
  }).kind, "checkout");
});

test("default selection skips exhausted tiers and accepts unlimited inventory", () => {
  const remaining = { ...paid, quantity_total: null };
  const result = resolveGuestPurchase({
    ...input,
    tiers: [{ ...free, quantity_sold: 20 }, remaining],
  });
  assert.equal(result.kind, "checkout");
  if (result.kind === "checkout") assert.equal(result.tier, remaining);
});
