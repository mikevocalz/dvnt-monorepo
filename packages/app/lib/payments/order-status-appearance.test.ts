import assert from "node:assert/strict";
import test from "node:test";
import { getOrderStatusAppearance } from "./order-status-appearance.ts";

test("an expired checkout is not labelled declined or pending", () => {
  const config = getOrderStatusAppearance({
    status: "payment_failed", checkoutFailureReason: "checkout_expired",
  });
  assert.equal(config.label, "Checkout expired");
});

test("historical failure with no Stripe reason remains unknown", () => {
  const config = getOrderStatusAppearance({
    status: "payment_failed", checkoutFailureReason: null,
  });
  assert.equal(config.label, "Not completed");
});

test("genuine processor decline is displayed explicitly", () => {
  const config = getOrderStatusAppearance({
    status: "payment_failed", checkoutFailureReason: "payment_declined",
  });
  assert.equal(config.label, "Payment declined");
});

test("successful retry is paid even if stale diagnostics are returned", () => {
  const config = getOrderStatusAppearance({
    status: "paid", checkoutFailureReason: "checkout_expired",
  });
  assert.equal(config.label, "Paid");
});

test("bank failure, cancellation and unknown technical issues are distinct", () => {
  assert.equal(getOrderStatusAppearance({
    status: "payment_failed", checkoutFailureReason: "async_payment_failed",
  }).label, "Bank payment failed");
  assert.equal(getOrderStatusAppearance({
    status: "payment_failed", checkoutFailureReason: "payment_cancelled",
  }).label, "Payment cancelled");
  assert.equal(getOrderStatusAppearance({
    status: "payment_failed", checkoutFailureReason: "technical_failure",
  }).label, "Payment error");
});
