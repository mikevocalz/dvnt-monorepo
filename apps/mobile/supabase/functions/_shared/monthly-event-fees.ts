/**
 * Read-only monthly event-ticket platform fee ledger.
 * Source of truth: completed orders, not reconstructed event_financials.
 * The monthly window is America/New_York; paid_at is the accounting date.
 * Partially refunded orders are excluded and explicitly disclosed until
 * fee reversals are reconciled. No payout or organizer-transfer writes.
 */
import { readAllRows } from "./read-all-rows.ts";
import { nyMonthWindow } from "./organizer-platform-fees.ts";

export type MonthlyEventFees = {
  month: string;
  timeZone: "America/New_York";
  start: string;
  end: string;
  asOf: string;
  currency: "usd";
  paidOrders: number;
  chargedOrders: number;
  excludedPartiallyRefundedOrders: number;
  checkoutCents: number;
  buyerFeeCents: number;
  organizerFeeCents: number;
  grossPlatformFeeCents: number;
  stripeFeeCents: number;
  afterStripeFeeCents: number;
  provisional: true;
};

const cents = (value: unknown, label: string): number => {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Invalid ${label} in paid-order fee ledger`);
  }
  return value;
};
const add = (a: number, b: number) => {
  const total = a + b;
  if (!Number.isSafeInteger(total)) throw new Error("Fee ledger overflow");
  return total;
};

export function selectedNyMonth(month: string | undefined, now = new Date()) {
  const current = nyMonthWindow(now).month;
  const selected = month ?? current;
  if (!/^20\d{2}-(0[1-9]|1[0-2])$/.test(selected) || selected > current) {
    throw new Error("Invalid or future accounting month");
  }
  return nyMonthWindow(new Date(`${selected}-15T12:00:00.000Z`));
}

export async function readMonthlyEventFees(db: any, eventId: number, month?: string, now = new Date()): Promise<MonthlyEventFees> {
  const window = selectedNyMonth(month, now);
  const rows = await readAllRows(() => db.from("orders")
    .select("id,type,event_id,status,paid_at,currency,total_cents,buyer_fee_cents,organizer_fee_cents,dvnt_total_fee_cents,stripe_fee_cents")
    .eq("event_id", eventId).eq("type", "event_ticket")
    .in("status", ["paid", "partially_refunded"])
    .gte("paid_at", window.start).lt("paid_at", window.end));
  const result: MonthlyEventFees = {
    month: window.month, timeZone: "America/New_York", start: window.start, end: window.end,
    asOf: now.toISOString(), currency: "usd", paidOrders: 0, chargedOrders: 0,
    excludedPartiallyRefundedOrders: 0, checkoutCents: 0, buyerFeeCents: 0,
    organizerFeeCents: 0, grossPlatformFeeCents: 0, stripeFeeCents: 0,
    afterStripeFeeCents: 0, provisional: true,
  };
  for (const row of rows) {
    const paidAt = Date.parse(row.paid_at);
    if (row.event_id !== eventId || row.type !== "event_ticket" ||
        !["paid", "partially_refunded"].includes(row.status) ||
        !Number.isFinite(paidAt) ||
        paidAt < Date.parse(window.start) || paidAt >= Date.parse(window.end) ||
        paidAt > now.getTime()) {
      throw new Error("Out-of-scope fee ledger row");
    }
    if (row.status === "partially_refunded") {
      result.excludedPartiallyRefundedOrders++;
      continue;
    }
    if (String(row.currency).toLowerCase() !== "usd") throw new Error("Non-USD fee ledger row");
    const checkout = cents(row.total_cents, "checkout");
    const buyer = cents(row.buyer_fee_cents, "buyer fee");
    const organizer = cents(row.organizer_fee_cents, "organizer fee");
    const gross = cents(row.dvnt_total_fee_cents, "gross DVNT fee");
    if (add(buyer, organizer) !== gross || (checkout === 0 && gross !== 0)) {
      throw new Error("Fee component mismatch");
    }
    const stripe = checkout > 0 ? cents(row.stripe_fee_cents, "Stripe processing fee") :
      row.stripe_fee_cents == null ? 0 : cents(row.stripe_fee_cents, "Stripe processing fee");
    result.paidOrders++;
    if (checkout > 0) result.chargedOrders++;
    result.checkoutCents = add(result.checkoutCents, checkout);
    result.buyerFeeCents = add(result.buyerFeeCents, buyer);
    result.organizerFeeCents = add(result.organizerFeeCents, organizer);
    result.grossPlatformFeeCents = add(result.grossPlatformFeeCents, gross);
    result.stripeFeeCents = add(result.stripeFeeCents, stripe);
  }
  result.afterStripeFeeCents = result.grossPlatformFeeCents - result.stripeFeeCents;
  return result;
}
