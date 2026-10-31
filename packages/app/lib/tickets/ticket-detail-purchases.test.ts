import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveTicketDetailPurchases, ticketServicePurchaseHref } from "./ticket-detail-purchases.ts";
import type { TicketRecord } from "../api/tickets";
import type { TicketTypeRecord } from "../api/ticket-types";

const admission = { id: "admission", event_id: 42, category: "admission", name: "Admission", price_cents: 2500, quantity_total: 10, quantity_sold: 10, max_per_user: 1, is_active: true, status: "on_sale" } as TicketTypeRecord;
const service = { ...admission, id: "service", category: "service", name: "Coat Check", price_cents: 1000, quantity_sold: 0, max_per_user: 2 } as TicketTypeRecord;
const vip = { ...admission, id: "vip", price_cents: 5000, quantity_sold: 0 };
const original = { id: "original", event_id: 42, user_id: "fixture-auth", ticket_type_id: admission.id, category: "admission", status: "active", purchase_amount_cents: 0, qr_token: "original-synthetic-qr" } as TicketRecord;
function offers(ticket = original, tiers = [admission, service, vip], tickets = [ticket], viewerId = "fixture-user", viewerAuthId = "fixture-auth") {
  return resolveTicketDetailPurchases({ ticket, tiers, tickets, viewerId, viewerAuthId });
}

for (const purchase_amount_cents of [0, 2500]) for (const status of ["active", "scanned"] as const) {
  test(`holder ${purchase_amount_cents}/${status}: service is independent of sold-out admission and its cap`, () => {
    const ticket = { ...original, purchase_amount_cents, status };
    const before = JSON.stringify(ticket);
    const result = offers(ticket);
    assert.deepEqual(result.services.map(t => t.id), [service.id]);
    assert.deepEqual(result.upgrades.map(t => t.id), status === "active" ? [vip.id] : []);
    assert.equal(result.canBuyMore, true);
    assert.equal(JSON.stringify(ticket), before);
  });
}

test("service credentials cannot be advertised as admission upgrades", () => {
  const result = offers({ ...original, category: "service", ticket_type_id: service.id });
  assert.deepEqual(result.upgrades, []);
  assert.deepEqual(result.services.map(t => t.id), [service.id]);
});

test("service limits include only this viewer's matching service tickets", () => {
  const one = { ...original, id: "service-one", ticket_type_id: service.id, category: "service" } as TicketRecord;
  assert.equal(offers(original, [admission, service], [original, one]).services.length, 1);
  assert.equal(offers(original, [admission, service], [original, one, { ...one, id: "service-two" }]).services.length, 0);
  assert.equal(offers(original, [admission, service], [original, one, { ...one, id: "other", user_id: "another-viewer" }]).services.length, 1);
});

test("unavailable, hidden, locked, inactive and foreign-event service offers stay out", () => {
  for (const patch of [
    { quantity_sold: 10 }, { is_active: false }, { status: "paused" },
    { tier_visibility: "hidden" }, { tier_visibility: "locked" },
    { sale_start: "2099-01-01T00:00:00Z" }, { sale_end: "2000-01-01T00:00:00Z" }, { event_id: 43 },
  ]) assert.equal(offers(original, [admission, { ...service, ...patch } as TicketTypeRecord]).services.length, 0);
});

test("signed-out, wrong-account, refunded, void and transferring passes expose no purchase offers", () => {
  for (const status of ["refunded", "void", "transfer_pending"] as const) assert.equal(offers({ ...original, status }).canBuyMore, false);
  assert.equal(offers(original, [service], [original], "anon", "fixture-auth").canBuyMore, false);
  assert.equal(offers(original, [service], [original], "another", "another-auth").canBuyMore, false);
});

test("wallet navigation targets the original event and exact service, never upgrade or checkout", () => {
  assert.equal(ticketServicePurchaseHref("42", "service", "web"), "/feed/events/42?serviceTier=service");
  assert.equal(ticketServicePurchaseHref("42", "service", "native"), "/(protected)/events/42?serviceTier=service");
  assert.match(ticketServicePurchaseHref("42", "a&redirect=other", "web"), /serviceTier=a%26redirect%3Dother$/);
});
