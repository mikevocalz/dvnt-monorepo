# Recovering a paid cart after a failed payment attempt

A `payment_intent.payment_failed` event describes an attempt, not necessarily
the final PaymentIntent outcome. The buyer can retry the same intent. Cart
attempt failures now preserve the original reservation deadline and pending
order. They cannot downgrade a paid order or release completed inventory.

Before issuing a cart, the server retrieves the current PaymentIntent with its
latest charge. It requires succeeded/captured payment, no refund or dispute,
and matching cart, owner, event, amount and currency. Provider errors fail closed.
There is no automatic refund or new charge in this path.

`complete_paid_cart_atomic` serializes on the cart and inventory. It can restore
released/expired reservations at the original paid price only when stock remains
after other live cart and ticket holds. Admission-only, add-on-only and mixed
carts use the same transaction. A late allocator rejection rolls back the whole
allocation and restored holds. Partial historical allocations require review;
they are not silently duplicated. Completed replays are idempotent.

The reconciler also considers failed cart orders with an existing
`reconcile_blocked` marker, rather than treating all failed checkouts as paid.
Current Stripe verification is still mandatory. Verification or allocation
failures increment failure/attention counters instead of reporting zero work.

## Reviewed release order

1. Verify the existing `20261017110000_checkout_failure_taxonomy.sql` migration
   is applied (diagnostic columns/constraints and success-clearing trigger).
2. Apply `20261029024347_paid_cart_retry_fulfillment.sql`.
3. Deploy `stripe-webhook` and `reconcile-orders` with their shared imports.
   Preserve existing webhook signature and cron authentication configuration.
4. Verify function definitions, service-only grants, deployed sources and health.

These steps require production approval. Applying the function definitions alone
does not fulfill orders; deploying the worker/webhook can automatically recover
eligible marked orders on the next retry/sweep. Do not deploy while assuming
that recovery is merely a preview.

## Individual recovery checklist

- Use authorized read-only Stripe access to confirm the exact current intent,
  captured amount/currency, correct live/test account, charge/refund/dispute
  state and cart/owner/event metadata. An old success webhook is insufficient.
- Read the exact order, cart and line items. Check all existing tickets/add-ons,
  partial refunds, inventory, event status and any replacement purchase.
- If Stripe access is unavailable, stop. Do not borrow secrets or bypass account
  permissions. If the payment was refunded/disputed, do not issue entitlement.
- After approved deployment and explicit recovery approval, prefer the existing
  signed Stripe event resend or authorized reconciliation path. Do not manually
  reset cart state/hold expiry or call a raw allocator outside the validated path.
- Re-read the order and each expected line: exactly the purchased units, one QR
  per redeemable add-on unit, paid/completed state, and correct stock. Verify a
  repeated delivery does not allocate again. Never perform a live redemption as
  a health check. No charge, refund or customer message is implied by recovery.

## Tests

- `npm run test:cart-recovery`: signed webhook sequences and actual reconciler
  handler using offline Stripe/database fixtures.
- `npm run test:cart-recovery:sql`: disposable real PostgreSQL transaction,
  capacity, permission, refund and concurrency tests. Requires `pg` and PostgreSQL.
- `POSTGRES_SINGLE_USER=1 npm run test:cart-recovery:sql`: explicitly sequential
  fallback; it does **not** establish concurrent-session behavior. CI uses the
  full multi-session suite without a skip fallback.
