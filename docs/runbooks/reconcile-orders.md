# Runbook — reconcile-orders

**What:** Expires stale `ticket_holds`, then finds `payment_pending` orders older than `hours_back` (default 2, max 48) and reconciles each against Stripe PaymentIntent / Checkout Session status — issues missed tickets, converts holds, or marks `payment_failed`. ACH/bank sessions left `processing` (not a failure). Money-tier.

**Schedule:** Documented "every 15 minutes via cron" in the fn header — **NOT present in live `cron.job`** (unverified cadence; invoked by an external scheduler/EAS or manually today). Edge fn auth: `x-cron-secret` (`CRON_SECRET`).

**Idempotency:** Order claim is atomic CAS (`.eq("status","payment_pending")`); ticket issue is gated by an existing-tickets count on the PaymentIntent. Already idempotent.

**Lock:** `tryClaimJob("reconcile-orders", 300s)` — overlap returns `{skipped}`. Per-order CAS is the real double-issue guard.

**Heartbeat / alert route:** `withHeartbeat("reconcile-orders")`. Dead-man: db-health watchdog fires ONE clamped Sentry error when `now() - last_ok_at > 30m` (15m interval + 15m margin). Absent heartbeat row (never run since deploy) is NOT alerted.

**Manual re-run:**
```
curl -sS -X POST "$SUPABASE_URL/functions/v1/reconcile-orders" \
  -H "x-cron-secret: $CRON_SECRET" -H "Content-Type: application/json" -d '{"hours_back":2}'
```

## Checkout failure taxonomy (October 2026)

`orders.status = 'payment_failed'` is a legacy, terminal **order** state and
must not be interpreted as "card declined". Additive fields
`checkout_failure_reason` and `checkout_failure_code` are diagnostics:

| reason | Evidence |
| --- | --- |
| `checkout_expired` | Stripe Checkout Session expired or reconciler successfully expired it |
| `checkout_abandoned` | Unconfirmed PaymentIntent cancelled with reason `abandoned` after hold cutoff |
| `payment_cancelled` | Stripe payment cancelled for another reason; not necessarily buyer cancellation |
| `payment_declined` | Stripe PaymentIntent had `last_payment_error.decline_code` or `card_declined` |
| `payment_attempt_failed` | Stripe reported PI failure without evidence of a bank/card decline |
| `async_payment_failed` | Stripe `checkout.session.async_payment_failed` |
| `payment_reference_missing` | Reconciler got Stripe `resource_missing`; investigate key/account mismatch |
| `technical_failure` | Reserved for verified DVNT/processor technical errors; never infer from abandonment |
| NULL | Historical or unclassified failure, **not** proof of card decline |

The webhook and reconciler retain the existing guarded `payment_failed`
status transitions and ticket-hold release. Each new terminal outcome records
a human-readable `order_timeline` entry only after the order transition.
For PaymentIntent failures a newer Stripe event must pass the existing
monotonic `upsert_order_money_state` guard before a reason is written.
The database clears failure diagnostics automatically if the order transitions
to `paid` after retry. Do not set a failure reason on already-paid orders.
Neither raw Stripe messages nor any customer/card details are recorded.

### Deployment order and verification

1. Apply `20261017110000_checkout_failure_taxonomy.sql` before deploying
   `stripe-webhook` and `reconcile-orders`. This is additive, nullable, and
   does not backfill unknown historical failures.
2. Deploy both Edge Functions from the same revision; preserve webhook
   signature verification, delivery deduplication, pending→failed CAS, and
   Stripe-side intent/session cancellation before failing stale orders.
3. Run `pnpm test:checkout-failures` and the payments/issuance regression suite.
4. In a Stripe **sandbox**, test a session timeout, unconfirmed abandoned
   PaymentIntent, actual `card_declined`, asynchronous bank failure, stale
   webhook after successful payment, and recovery to paid. Verify no issued
   ticket is voided and no failure reason remains on a recovered paid order.
5. **Do not mass-update historical records.** Identify old checkout outcomes
   from Stripe API evidence before backfilling. Never equate
   `stripe_events` counts with order counts or treat a failed attempt as a
   definitively lost customer (buyers may retry successfully).

Reporting SQL should count only paid orders for platform-fee revenue using
`paid_at` and `dvnt_total_fee_cents`; `checkout_failure_reason` is for the
separate checkout funnel. Count each order only once, and do not sum fees from
failed orders into earned revenue. For suspected premature expiry, examine the
Stripe session's `expires_at`, webhook timestamp and order creation time.
