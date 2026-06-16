# DVNT Monetization V1 — Ops Runbook

## Pre-deploy Checklist

- [ ] Stripe secret key updated in Supabase Edge Function secrets
- [ ] `STRIPE_WEBHOOK_SECRET` env var set for the webhook Edge Function
- [ ] `STRIPE_PUBLISHABLE_KEY` set for `create-payment-intent`
- [ ] Run `002_apply.sql` in Supabase SQL Editor
- [ ] Run `003_verify.sql` and confirm all checks PASS
- [ ] Deploy Edge Functions:
  - `supabase functions deploy ticket-checkout`
  - `supabase functions deploy create-payment-intent`
  - `supabase functions deploy stripe-webhook`
  - `supabase functions deploy sneaky-billing-checkout`
  - `supabase functions deploy sneaky-billing-portal`
- [ ] Register webhook in Stripe Dashboard → Developers → Webhooks:
  - Events: `checkout.session.completed`, `payment_intent.succeeded`,
    `payment_intent.payment_failed`, `charge.refunded`, `charge.dispute.created`,
    `account.updated`, `customer.subscription.created`,
    `customer.subscription.updated`, `customer.subscription.deleted`,
    `invoice.payment_failed`

---

## Fee Model (v1_250_1pt)

| Party | Fee |
|---|---|
| Buyer | 2.5% of subtotal + $1.00/ticket |
| Organizer | 2.5% of subtotal + $1.00/ticket (deducted from payout) |
| DVNT total | 5% + $2.00/ticket |

**Rule**: buyer_pct_fee and org_pct_fee are rounded SEPARATELY.
Never compute `Math.round(subtotal * 0.05)` — this causes drift.

**Invariant**: `customer_charge = organizer_transfer + application_fee_amount`

---

## Stripe Connect — Organizer Onboarding

Before any paid ticket sale, `organizer_accounts.charges_enabled` must be `true`.
Checked in both `ticket-checkout` and `create-payment-intent`.

To trigger onboarding: connect the host's Stripe account via Express onboarding flow (TBD separate feature).

---

## Stripe Billing — Sneaky Subscriptions

Plans are seeded in `sneaky_subscription_plans`:

| plan_id | price |
|---|---|
| free | $0 |
| host_25 | $14.99/mo |
| host_50 | $24.99/mo |

On first `sneaky-billing-checkout` call, the Stripe Product + Price are created automatically
and cached in `sneaky_subscription_plans.stripe_product_id / stripe_price_id`.

**Webhook is source of truth.** The UI polls `sneaky_subscriptions` after browser close.

---

## Webhook Idempotency

Events are deduplicated via `stripe_events` table (unique `event_id` constraint, code `23505`).
Duplicate events return `{ received: true, duplicate: true }` with HTTP 200.

---

## Refund Policy

DVNT service fees (`dvnt_total_fee_cents`) are **non-refundable**.

When a refund is issued via Stripe Dashboard, only the base ticket price
(`subtotal_cents`) should be refunded. The `application_fee_amount` is
retained by DVNT's platform account automatically via Stripe Connect.

To refund only base price in Stripe Dashboard:
- Go to Charge → Refund → Custom amount → enter `subtotal_cents / 100`
- The `application_fee_amount` is NOT included in the refund

---

## Rollback

Run `004_rollback.sql` in Supabase SQL Editor to revert all DDL changes.
This only drops NEW tables/columns; existing tables are untouched.

---

## Fee Calculation Test Vectors

```
computeFees(subtotal=1000, qty=1)  // $10.00 × 1
  buyer_pct_fee   = round(1000 * 0.025) = 25
  buyer_per_ticket = 100
  buyer_fee        = 125
  org_pct_fee     = 25
  org_per_ticket  = 100
  organizer_fee    = 125
  dvnt_total_fee   = 250
  customer_charge  = 1125
  org_transfer     = 875

computeFees(subtotal=4000, qty=2)  // $20.00 × 2
  buyer_pct_fee   = round(4000 * 0.025) = 100
  buyer_per_ticket = 200
  buyer_fee        = 300
  organizer_fee    = 300
  dvnt_total_fee   = 600
  customer_charge  = 4300
  org_transfer     = 3700
```
