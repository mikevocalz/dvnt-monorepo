# Paid ticket allocation: release monitoring and recovery

This is an operator guide, not permission to run a migration, replay a webhook,
issue a ticket, send mail, charge, refund, or edit production rows. The source
patch has no automatic refund/charge path. Any mutating recovery needs the
normal explicit operational authorization.

## What the patch proves, and what it does not

The paid single-tier RPC commits ticket rows, sold inventory, hold conversion,
and the order's payment link together. Retries cannot mint a second bundle.
A validated complete legacy bundle can repair its sold floor, matching hold,
and missing payment link without adding tickets. Refunded/void terminal
purchases never trigger a fresh fulfillment email.

The shared single-tier hold admission guard uses the greater of the recorded
sold count and actual kept ticket count, plus both live hold tables. This
reduces acceptance of purchases against stale low counters. It does not make
cart admission, free issuers that bypass this RPC, transfers, upgrades, or
refund writers globally transactional. Conservative overcounts can still
block availability. A delayed payment with an expired hold, an ambiguous
legacy association, or an already-paid allocation conflict remains a visible
`needs_recovery` failure rather than an oversold or fabricated success.

That is safer than split issuance, but not a guarantee that every paid purchase
will self-recover. Money-state and email delivery are still subsequent,
retryable steps, not part of the allocation transaction. Promo usage and other
post-allocation side effects are not a transactional outbox.

## Read-only checks before and after an approved release

Use the verified DVNT project and least-privileged read-only access. Record the
source commit, migration checksum, deployed function versions, and UTC window.
Do not copy customer emails, QR codes, guest links, credentials, or raw payment
payloads into public issues or PRs.

1. Compare `stripe-webhook` and `reconcile-orders` HTTP 5xx counts and error
   categories before/after the release. Investigate any new `Paid ticket
   allocation needs recovery`, missing-RPC, permission, or invalid-result error.
   A webhook HTTP 500 intentionally remains retryable; do not mark it processed
   to silence an alert.
2. Verify the `reconcile-orders-every-15min` cron job remains active and recent
   runs succeed. HTTP 200 alone is not proof that every order was repaired.
3. Run bounded aggregate order/bundle and guest-delivery diagnostics below.
   Compare counts to the pre-release baseline; investigate nonzero changes.
4. For a specific suspected delayed/failed order, verify the payment's current
   status through the read-only Stripe API/dashboard before classifying it as
   paid. A local `payment_pending` order or an attached PI is not payment proof.
5. Inspect the affected tier's recorded sold count, actual kept tickets, and
   both live hold sums. Do not lower a counter, release a hold, or create a
   replacement purchase as a diagnostic step.

### Aggregate order/bundle diagnostic (read only)

This intentionally includes legacy Stripe-linked ticket rows and excludes carts.
It reports no customer identity or credentials. Run it over the release window
or a short bounded lookback; a mismatch needs investigation, not automatic repair.

```sql
WITH recent AS (
  SELECT id, quantity, status, total_cents, paid_at, guest_email,
         ticket_email_status, stripe_payment_intent_id, stripe_checkout_session_id
  FROM public.orders
  WHERE type = 'event_ticket' AND cart_id IS NULL
    AND created_at >= now() - interval '48 hours'
), bundles AS (
  SELECT o.*, (
    SELECT count(*) FROM public.tickets t
    WHERE t.order_id = o.id
       OR (o.stripe_payment_intent_id IS NOT NULL
           AND t.stripe_payment_intent_id = o.stripe_payment_intent_id)
       OR (o.stripe_checkout_session_id IS NOT NULL
           AND t.stripe_checkout_session_id = o.stripe_checkout_session_id)
  ) AS linked_tickets
  FROM recent o
)
SELECT
  count(*) FILTER (WHERE status = 'paid' AND total_cents > 0) AS paid_purchases,
  count(*) FILTER (WHERE status = 'paid' AND total_cents > 0
                   AND linked_tickets <> quantity) AS paid_bundle_mismatches,
  count(*) FILTER (WHERE status = 'paid' AND guest_email IS NOT NULL
                   AND ticket_email_status IS DISTINCT FROM 'sent'
                   AND paid_at < now() - interval '30 minutes') AS guest_delivery_backlog
FROM bundles;
```

### Inventory diagnostic (read only)

Replace the placeholder locally with the verified affected tier UUID. Preserve
both numbers: the recorded counter may overcount, while the actual kept rows
are a conservative floor, not an automatic repair instruction.

```sql
SELECT tt.id, tt.quantity_total, tt.quantity_sold,
  (SELECT count(*) FROM public.tickets t
    WHERE t.ticket_type_id = tt.id
      AND t.status IS DISTINCT FROM 'refunded'
      AND t.status IS DISTINCT FROM 'void') AS kept_tickets,
  (SELECT coalesce(sum(h.quantity), 0) FROM public.ticket_holds h
    WHERE h.ticket_type_id = tt.id AND h.status = 'active'
      AND h.expires_at > now()) AS live_ticket_holds,
  (SELECT coalesce(sum(h.qty), 0) FROM public.cart_holds h
    WHERE h.tier_id = tt.id AND h.released = false
      AND h.expires_at > now()) AS live_cart_holds
FROM public.ticket_types tt
WHERE tt.id = '<verified-tier-uuid>'::uuid;
```

## Operator decision guide

- **Missing RPC or permission error:** stop the rollout. Verify the separately
  approved additive migration and exact deployed source. Do not fall back to
  the old split-write issuer or silently apply a migration.
- **No tickets, payment not settled:** do not label the purchase paid or ask for
  another payment. Follow the existing pending-payment flow.
- **No tickets, payment settled, allocation missing/expired/insufficient:**
  retain the payment/order evidence and confirm real inventory. Escalate for an
  authorized allocation recovery or customer-resolution decision. Do not mint
  tickets outside the allocator, assume an extra seat exists, or auto-refund.
- **Partial, excessive, wrong-owner, or conflicting legacy bundle:** freeze
  ad-hoc repair. Reconcile the exact order/payment/ticket associations with an
  authorized operator. The RPC deliberately refuses to fill a partial set.
- **Complete valid bundle but pending money state/active matching hold:** once
  the underlying cause is resolved, an explicitly approved replay through the
  canonical fulfillment path can repair state without reinserting tickets.
  This guide does not authorize invoking a replay against production.
- **Paid complete bundle but email not sent:** inspect delivery status/attempts
  and provider result before an authorized resend. The current reconciler only
  retries within its configured lookback and attempt ceiling; it is not an
  unlimited durable outbox. Do not issue replacement tickets to fix email.
- **Refunded, partially refunded, disputed, cancelled, or void:** do not
  reactivate or send a fresh fulfillment bundle. Use the established support
  and financial process with explicit approval.

Post-release observation is complete only when approved source/schema versions
match, the scheduled reconciler remains healthy, and no unexplained new paid
bundle/delivery mismatch appears in the agreed observation window. Device
PaymentSheet, scanner, and wallet smoke tests remain separate evidence.
