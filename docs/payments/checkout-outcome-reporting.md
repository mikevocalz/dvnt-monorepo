# Checkout outcomes and platform-fee reporting

## Why this exists

DVNT historically uses `orders.status = 'payment_failed'` for more than one
outcome: Stripe Checkout session expiration, an unconfirmed PaymentIntent
cancelled after its hold expired, and actual unsuccessful payment attempts.
**That status alone does not prove a declined card or a lost customer.**

This reporting guide belongs to the **existing DVNT Supabase / Stripe backend**
and the current app purchase UX. It does not add a second payments database or
dashboard. The underlying reason data is introduced by the dependent
`fix/checkout-failure-outcomes-20261017` PR.

## Reporting contract

- **Earned DVNT platform fees:** count `status='paid'` + `type='event_ticket'`
  using `paid_at` in the specified `America/New_York` period; sum
  `dvnt_total_fee_cents`, with `buyer_fee_cents` and
  `organizer_fee_cents` as components. Fees are **gross**, not a confirmed
  payout or net profit.
- **Stripe processing fees:** show `stripe_fee_cents` separately; do not
  subtract it from gross DVNT fees unless allocation is independently verified.
- **Attempted but incomplete checkouts:** count distinct order IDs from
  `status='payment_failed'` by `created_at` and
  `checkout_failure_reason`. Never sum projected fees on these orders into
  earned revenue.
- **Unknown is unknown:** `checkout_failure_reason IS NULL` means an
  unclassified/historical outcome, NOT a decline.
- **Retries:** match later paid orders only for diagnostic conversion funnel,
  not as evidence that the original failed order succeeded. Do not collapse
  genuine individual orders for revenue. Avoid exposing email addresses in
  dashboards/logs.
- **City:** venue addresses may be used as a fallback to display a location,
  but treat events with `city_id IS NULL` as unmapped until corrected.
- **Recovery:** a subsequent `paid` status supersedes any legacy failure
  diagnostics. Status views only display failure labels while the order is
  still `payment_failed`.

### Read-only monthly diagnostic (admin SQL runner)

Replace the period boundaries as required. This is an **orders** breakdown,
not Stripe webhook event counts (there may be multiple events per order).

```sql
WITH period_orders AS (
  SELECT o.id, o.event_id, o.status, o.type, o.created_at, o.paid_at,
         o.total_cents, o.dvnt_total_fee_cents, o.buyer_fee_cents,
         o.organizer_fee_cents, o.stripe_fee_cents,
         o.checkout_failure_reason
  FROM public.orders o
  WHERE o.type = 'event_ticket'
    AND o.currency = 'usd'
    AND (
      (o.status = 'paid'
       AND o.paid_at >= ('2026-10-01'::timestamp AT TIME ZONE 'America/New_York')
       AND o.paid_at < ('2026-11-01'::timestamp AT TIME ZONE 'America/New_York'))
      OR
      (o.status = 'payment_failed'
       AND o.created_at >= ('2026-10-01'::timestamp AT TIME ZONE 'America/New_York')
       AND o.created_at < ('2026-11-01'::timestamp AT TIME ZONE 'America/New_York'))
    )
)
SELECT e.id AS event_id, e.title AS event_title,
       e.location_address, e.city_id,
       COUNT(p.id) FILTER (WHERE p.status='paid') AS completed_orders,
       COUNT(p.id) FILTER (
         WHERE p.status='paid' AND COALESCE(p.total_cents,0)>0
       ) AS monetary_orders,
       COUNT(p.id) FILTER (
         WHERE p.status='paid' AND COALESCE(p.total_cents,0)=0
       ) AS comp_orders,
       COALESCE(SUM(p.dvnt_total_fee_cents) FILTER (WHERE p.status='paid'),0)
         AS earned_dvnt_fee_cents,
       COALESCE(SUM(p.buyer_fee_cents) FILTER (WHERE p.status='paid'),0)
         AS buyer_fee_cents,
       COALESCE(SUM(p.organizer_fee_cents) FILTER (WHERE p.status='paid'),0)
         AS organizer_fee_cents,
       COALESCE(SUM(p.stripe_fee_cents) FILTER (WHERE p.status='paid'),0)
         AS recorded_stripe_processing_fee_cents,
       COALESCE(SUM(p.total_cents) FILTER (WHERE p.status='paid'),0)
         AS gross_checkout_cents,
       COUNT(p.id) FILTER (
         WHERE p.status='payment_failed'
       ) AS unsuccessful_checkout_orders,
       COUNT(p.id) FILTER (
         WHERE p.status='payment_failed'
           AND p.checkout_failure_reason='checkout_expired'
       ) AS expired_checkouts,
       COUNT(p.id) FILTER (
         WHERE p.status='payment_failed'
           AND p.checkout_failure_reason='checkout_abandoned'
       ) AS abandoned_intents,
       COUNT(p.id) FILTER (
         WHERE p.status='payment_failed'
           AND p.checkout_failure_reason='payment_declined'
       ) AS proven_declines,
       COUNT(p.id) FILTER (
         WHERE p.status='payment_failed'
           AND p.checkout_failure_reason='technical_failure'
       ) AS diagnosed_technical_failures,
       COUNT(p.id) FILTER (
         WHERE p.status='payment_failed'
           AND p.checkout_failure_reason IS NULL
       ) AS unclassified_failures
FROM period_orders p
LEFT JOIN public.events e ON e.id = p.event_id
GROUP BY e.id, e.title, e.location_address, e.city_id
ORDER BY earned_dvnt_fee_cents DESC;
```

### Separate unmatched statuses

The query above spotlights the highest-interest reasons. For the full taxonomy:

```sql
SELECT COALESCE(checkout_failure_reason, 'unclassified') AS reason,
       COUNT(*) AS attempted_checkouts,
       SUM(COALESCE(total_cents,0)) AS uncollected_checkout_quotes_cents
FROM public.orders
WHERE type='event_ticket'
  AND status='payment_failed'
  AND created_at >= ('2026-10-01'::timestamp AT TIME ZONE 'America/New_York')
  AND created_at < ('2026-11-01'::timestamp AT TIME ZONE 'America/New_York')
GROUP BY 1 ORDER BY attempted_checkouts DESC;
```

## October 2026 forensics: do not misrepresent failures

A live read on October 17 found 35 orders in `payment_failed`:
- 30 carried hosted Stripe Checkout session IDs.
- Five carried PaymentIntent IDs and were cancelled by the existing
  reconciliation cleanup. Their timeline labels said "Checkout abandoned".
- One session-associated order changed state within roughly **30 seconds**,
  unlike the cluster around 30 minutes. Inspect its actual Stripe status,
  `expires_at`, webhook event timing, event id, and reservation/hold window
  before attributing a cause.
- 13 failed-order rows were followed by purchases using the same event and
  normalized email within 48 hours. Those represent 11 paid follow-up orders;
  do not call all 35 permanent lost sales.

The `stripe_events` table stores event type and processed timestamp but not
the full decline reason payload. Stripe's evidence (PaymentIntent
`last_payment_error`, Checkout Session status and payment status, event id)
is needed for a definitive cause. Store only safe code enums, **not** full
Stripe error messages or buyer payment credentials.

## Acceptance matrix

| Scenario | Money status | Diagnostic reason | UI label |
| --- | --- | --- | --- |
| Hosted Checkout expires | `payment_failed` | `checkout_expired` | Checkout expired |
| Customer leaves PaymentSheet; cleaner cancels after hold cutoff | `payment_failed` | `checkout_abandoned` | Not completed |
| Stripe confirms genuine card decline | `payment_failed` | `payment_declined` | Payment declined |
| Other payment-attempt failure | `payment_failed` | `payment_attempt_failed` | Payment incomplete |
| Delayed bank settlement fails | `payment_failed` | `async_payment_failed` | Bank payment failed |
| Confirmed payment / later recovery | `paid` | cleared / ignored | Paid |
| Existing failure without diagnostic evidence | `payment_failed` | NULL | Not completed |

Run `pnpm test:checkout-failures`, `node --test
packages/app/lib/payments/order-status-appearance.test.ts`, ticket issuance
and Stripe webhook regressions, plus test-mode session expiry, attempted
declines, cancellation, retry success, and replay out-of-order. Verify
**no ticket issued for an unpaid checkout and no paid order incorrectly
downgraded by a late failure webhook**. Production SQL/deploy and any
historical reclassification require explicit rollout and verification.
