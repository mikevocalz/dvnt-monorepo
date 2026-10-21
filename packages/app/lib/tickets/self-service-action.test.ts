import test from "node:test";
import assert from "node:assert/strict";
import { getTicketSelfServiceAction, ticketSelfServiceCopy } from "./self-service-action.ts";

const now = Date.parse("2026-10-21T12:00:00Z");
const base = {
  status: "active", checked_in_at: null, transferred_from: null,
  purchase_amount_cents: 0, event_date: "2026-11-01T12:00:00Z",
  self_service_action: "cancel_free" as const,
};

test("free, comp and 100%-discount tickets never offer a monetary refund", () => {
  for (const stripe_payment_intent_id of [undefined, null, "pi_discounted"]) {
    const row = { ...base, stripe_payment_intent_id };
    assert.equal(getTicketSelfServiceAction(row, now), "cancel_free");
    assert.equal(getTicketSelfServiceAction({ ...row, self_service_action: "refund" }, now), null);
  }
  assert.equal(ticketSelfServiceCopy("cancel_free", "admission").label, "Cancel RSVP");
  assert.equal(ticketSelfServiceCopy("cancel_free", "product").label, "Cancel Ticket");
  assert.doesNotMatch(ticketSelfServiceCopy("cancel_free").loading, /refund/i);
  assert.match(ticketSelfServiceCopy("cancel_free").body, /No money will be refunded/);
});

test("only known positive payments offer refunds", () => {
  const paid = { ...base, self_service_action: "refund" as const, purchase_amount_cents: 2000, stripe_payment_intent_id: "pi_paid" };
  assert.equal(getTicketSelfServiceAction(paid, now), "refund");
  assert.equal(ticketSelfServiceCopy("refund").label, "Request Refund");
  assert.equal(getTicketSelfServiceAction({ ...paid, stripe_payment_intent_id: null }, now), null);
  for (const amount of [undefined, null, -1, NaN, Infinity, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(getTicketSelfServiceAction({ ...paid, purchase_amount_cents: amount }, now), null);
  }
});

test("missing or refused server eligibility fails closed", () => {
  assert.equal(getTicketSelfServiceAction(undefined, now), null);
  for (const self_service_action of [null, undefined]) {
    assert.equal(getTicketSelfServiceAction({ ...base, self_service_action }, now), null);
  }
});

test("used, cancelled, refunded, transfer-pending and received tickets expose no action", () => {
  for (const status of ["scanned", "void", "refunded", "transfer_pending", "unknown"]) {
    assert.equal(getTicketSelfServiceAction({ ...base, status }, now), null);
  }
  assert.equal(getTicketSelfServiceAction({ ...base, checked_in_at: "2026-10-20" }, now), null);
  assert.equal(getTicketSelfServiceAction({ ...base, transferred_from: "original-buyer" }, now), null);
});

test("event cutoff is rechecked locally, including missing and invalid dates", () => {
  for (const event_date of [undefined, "bad", "2026-10-20T12:00:00Z", "2026-10-22T12:00:00Z"]) {
    assert.equal(getTicketSelfServiceAction({ ...base, event_date }, now), null);
  }
  assert.equal(getTicketSelfServiceAction({ ...base, event_date: "2026-10-22T12:00:01Z" }, now), "cancel_free");
});

test("cart line routing requires positive line payment, while free grouped RSVPs can cancel", () => {
  assert.equal(getTicketSelfServiceAction({ ...base, cart_id: "group" }, now), "cancel_free");
  assert.equal(getTicketSelfServiceAction({ ...base, cart_id: "cart", cart_line_item_id: "line" }, now), null);
  const line = { ...base, self_service_action: "refund_line" as const, purchase_amount_cents: 1000, cart_id: "cart", cart_line_item_id: "line" };
  assert.equal(getTicketSelfServiceAction(line, now), "refund_line");
  assert.equal(getTicketSelfServiceAction({ ...line, purchase_amount_cents: 0 }, now), null);
  assert.equal(getTicketSelfServiceAction({ ...line, cart_id: null }, now), null);
});
