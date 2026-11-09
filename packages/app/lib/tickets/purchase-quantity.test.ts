import assert from "node:assert/strict";
import test from "node:test";
import { ticketPurchaseAllowance } from "./purchase-quantity.ts";
const tier = { id: "service-fixture", price_cents: 0, quantity_total: 100, quantity_sold: 1, max_per_user: 3 };
test("additional purchases retain cumulative active/scanned/pending limits for this tier", () => {
  const held = ["active", "scanned", "transfer_pending"].map(status => ({ ticket_type_id: tier.id, status }));
  assert.equal(ticketPurchaseAllowance(tier, held.slice(0, 1)), 2);
  assert.equal(ticketPurchaseAllowance(tier, held), 0);
  assert.equal(ticketPurchaseAllowance(tier, [{ ticket_type_id: "admission-fixture", status: "active" }]), 3);
  assert.equal(ticketPurchaseAllowance(tier, [{ ticket_type_id: tier.id, status: "refunded" }]), 3);
});
test("per-order cap and stock are independent limits, including free and service tiers", () => {
  assert.equal(ticketPurchaseAllowance({ ...tier, max_per_order: 1 }), 1);
  assert.equal(ticketPurchaseAllowance({ ...tier, quantity_total: 2 }), 1);
  assert.equal(ticketPurchaseAllowance({ ...tier, quantity_total: 1 }), 0);
});
