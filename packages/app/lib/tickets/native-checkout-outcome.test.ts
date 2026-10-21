import test from "node:test";
import assert from "node:assert/strict";
import {
  completeNativeTicketCheckout,
  type NativeTicketCheckoutResult,
  type PendingNativeTicketCheckout,
} from "./native-checkout-outcome.ts";

const ticket = (overrides = {}) => ({
  id: "ticket-new",
  qr_token: "server-credential",
  event_id: 42,
  ticket_type_id: "tier-ga",
  stripe_payment_intent_id: "pi_current",
  status: "active",
  ...overrides,
});

function fixture(
  options: {
    result?: NativeTicketCheckoutResult;
    read?: (
      attempt: number,
    ) => ReturnType<typeof ticket>[] | Promise<ReturnType<typeof ticket>[]>;
    quantity?: number;
  } = {},
) {
  let pending: PendingNativeTicketCheckout | undefined;
  let payments = 0;
  let reads = 0;
  const run = () =>
    completeNativeTicketCheckout({
      eventId: "42",
      ticketTypeId: "tier-ga",
      quantity: options.quantity ?? 1,
      pending,
      checkout: async () => {
        payments++;
        return (
          options.result ?? { success: true, paymentIntentId: "pi_current" }
        );
      },
      rememberPending: (purchase) => {
        pending = purchase;
      },
      clearPending: () => {
        pending = undefined;
      },
      readTickets: async () => {
        assert.ok(
          pending,
          "purchase must be remembered before any issuance read",
        );
        return options.read?.(++reads) ?? [];
      },
      wait: async () => {},
    });
  return {
    run,
    get pending() {
      return pending;
    },
    get payments() {
      return payments;
    },
    get reads() {
      return reads;
    },
  };
}

test("a delayed webhook remains pending, and rechecking never opens a second payment", async () => {
  const f = fixture({ read: (attempt) => (attempt > 5 ? [ticket()] : []) });
  assert.deepEqual(await f.run(), { kind: "pending" });
  assert.equal(f.reads, 5);
  assert.equal(f.pending?.paymentIntentId, "pi_current");
  assert.deepEqual(await f.run(), { kind: "issued", ticketCount: 1 });
  assert.equal(f.payments, 1);
  assert.equal(f.pending, undefined);
});

test("five read errors after PaymentSheet stay pending, not failed or successful", async () => {
  const f = fixture({
    read: () => {
      throw new Error("network unavailable");
    },
  });
  assert.deepEqual(await f.run(), { kind: "pending" });
  assert.deepEqual(await f.run(), { kind: "pending" });
  assert.equal(f.reads, 10);
  assert.equal(f.payments, 1);
});

test("an unrelated old active ticket for the same event proves nothing", async () => {
  const f = fixture({
    read: () => [ticket({ id: "old", stripe_payment_intent_id: "pi_old" })],
  });
  assert.deepEqual(await f.run(), { kind: "pending" });
  assert.equal(f.reads, 5);
});

test("a matching purchase, event, tier and complete quantity confirm issuance", async () => {
  const f = fixture({
    quantity: 2,
    read: () => [ticket(), ticket({ id: "ticket-second", status: "scanned" })],
  });
  assert.deepEqual(await f.run(), { kind: "issued", ticketCount: 2 });
  assert.equal(f.reads, 1);
});

test("partial issuance and duplicate rows never confirm the full requested purchase", async () => {
  const f = fixture({ quantity: 2, read: () => [ticket(), ticket()] });
  assert.deepEqual(await f.run(), { kind: "pending" });
});

test("wrong event, tier, refunded rows, and missing credentials cannot confirm issuance", async () => {
  for (const override of [
    { event_id: 99 },
    { ticket_type_id: "wrong" },
    { status: "refunded" },
    { id: "" },
    { qr_token: "" },
  ]) {
    const f = fixture({ read: () => [ticket(override)] });
    assert.deepEqual(
      await f.run(),
      { kind: "pending" },
      JSON.stringify(override),
    );
  }
});

test("free success uses this request's server-issued IDs and does not poll", async () => {
  const f = fixture({
    quantity: 2,
    result: {
      success: true,
      free: true,
      tickets: [
        { id: "free-1", qr_token: "qr-1" },
        { id: "free-2", qr_token: "qr-2" },
      ],
    },
  });
  assert.deepEqual(await f.run(), { kind: "issued", ticketCount: 2 });
  assert.equal(f.reads, 0);
  assert.equal(f.pending, undefined);
});

test("free flag without complete unique issued credentials remains pending", async () => {
  for (const tickets of [
    [],
    [{ id: "", qr_token: "qr" }],
    [{ id: "free-1", qr_token: "" }],
  ]) {
    const f = fixture({ result: { success: true, free: true, tickets } });
    assert.deepEqual(await f.run(), { kind: "pending" });
    assert.deepEqual(await f.run(), { kind: "pending" });
    assert.equal(f.payments, 1);
  }
});

test("missing PaymentIntent identity fails closed even with an active event ticket", async () => {
  const f = fixture({ result: { success: true }, read: () => [ticket()] });
  assert.deepEqual(await f.run(), { kind: "pending" });
  assert.deepEqual(await f.run(), { kind: "pending" });
  assert.equal(f.reads, 0);
  assert.equal(f.payments, 1);
});

test("cancellation and genuine payment failures do not lock a future attempt", async () => {
  const cancelled = fixture({
    result: { success: false, error: "Payment cancelled" },
  });
  assert.deepEqual(await cancelled.run(), { kind: "cancelled" });
  assert.equal(cancelled.pending, undefined);
  const failed = fixture({
    result: { success: false, error: "Card declined" },
  });
  assert.deepEqual(await failed.run(), {
    kind: "failed",
    error: "Card declined",
  });
  assert.equal(failed.pending, undefined);
});
