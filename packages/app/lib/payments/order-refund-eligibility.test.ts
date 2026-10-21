import { test } from "node:test";
import assert from "node:assert/strict";
import { canRequestOrderRefund } from "./order-refund-eligibility.ts";
import type { Order } from "../types/payments";

function order(totalCents: number, status: Order["status"] = "paid") {
  return { status, fees: { subtotalCents: 2500, platformFeeCents: 0,
    processingFeeCents: 0, taxCents: 0, totalCents } };
}

test("completed free, comp and fully discounted orders have no refund", () => {
  assert.equal(canRequestOrderRefund(order(0)), false);
});
test("positive final paid total, including add-ons or historical orders, can be requested", () => {
  assert.equal(canRequestOrderRefund(order(1)), true);
  assert.equal(canRequestOrderRefund(order(2500)), true);
});
test("all non-paid statuses suppress refund requests", () => {
  for (const status of ["created", "payment_pending", "payment_failed", "partially_refunded", "refunded", "disputed"] as const)
    assert.equal(canRequestOrderRefund(order(2500, status)), false, status);
});
test("unknown or malformed totals fail closed", () => {
  for (const amount of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity, -Infinity, undefined, null, "100"])
    assert.equal(canRequestOrderRefund(order(amount as number)), false, String(amount));
  assert.equal(canRequestOrderRefund(null), false);
  assert.equal(canRequestOrderRefund(undefined), false);
});
