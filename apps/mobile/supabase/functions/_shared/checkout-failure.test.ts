import assert from "node:assert/strict";
import test from "node:test";
import {
  checkoutFailureLabel,
  classifyPaymentIntentFailure,
  classifyReconciledFailure,
  safeStripeFailureCode,
} from "./checkout-failure.ts";

test("expired Checkout is never treated as a card decline", () => {
  assert.equal(classifyReconciledFailure({
    paymentStatus: "unpaid", checkoutSessionStatus: "expired",
  }), "checkout_expired");
  assert.equal(classifyReconciledFailure({
    paymentStatus: "unpaid", checkoutSessionStatus: "open",
  }), "checkout_expired");
  assert.equal(checkoutFailureLabel("checkout_expired"), "Checkout expired");
});

test("an abandoned/unconfirmed PaymentIntent is not marked declined", () => {
  assert.equal(classifyReconciledFailure({
    paymentStatus: "canceled", cancellationReason: "abandoned",
  }), "checkout_abandoned");
  assert.equal(classifyReconciledFailure({
    paymentStatus: "canceled", cancellationReason: "requested_by_customer",
  }), "payment_cancelled");
  assert.equal(classifyReconciledFailure({
    paymentStatus: "requires_payment_method",
  }), null);
  assert.equal(classifyReconciledFailure({ paymentStatus: "processing" }), null);
  assert.equal(classifyReconciledFailure({
    paymentStatus: "error:api_error",
  }), null);
});

test("payment-intent decline requires actual Stripe evidence", () => {
  assert.deepEqual(classifyPaymentIntentFailure({
    last_payment_error: { code: "card_declined", decline_code: "insufficient_funds" },
  }), { reason: "payment_declined", code: "insufficient_funds" });
  assert.deepEqual(classifyPaymentIntentFailure({
    last_payment_error: { code: "authentication_required" },
  }), { reason: "payment_attempt_failed", code: "authentication_required" });
  assert.deepEqual(classifyPaymentIntentFailure({}), {
    reason: "payment_attempt_failed", code: null,
  });
});

test("do not persist untrusted Stripe message strings", () => {
  assert.equal(safeStripeFailureCode("card_declined"), "card_declined");
  assert.equal(safeStripeFailureCode("Card declined: 4242"), null);
  assert.equal(safeStripeFailureCode("x".repeat(70)), null);
  assert.equal(safeStripeFailureCode({ code: "card_declined" }), null);
});
