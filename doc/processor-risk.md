# Processor Risk — Stripe Go / No-Go for the Web Rail

**Decision:** **GO for Stripe on Lynk.**

Lynk is video chat (not adult content). It is not in Stripe's restricted-businesses
list. The existing `apps/mobile/supabase/functions/stripe-webhook` already handles the
subscription lifecycle we need (`customer.subscription.*`, `invoice.paid`,
`invoice.payment_failed`) — Lynk subscriptions ride the same fn, distinguished by
`product_family` / `plan_key` metadata.

## What this unblocks

- D3 web rail = Stripe Checkout direct. No processor abstraction layer required.
- The `rail` column added in D2 still matters (`web_stripe` vs `ios_iap` / `play_iap`)
  because the entitlement source-of-truth must distinguish where the revenue came from
  for analytics + reconciliation — but there is only ONE web adapter and we don't need
  the CCBill/Verotel/Segpay fallbacks.

## What was dropped from the prior draft

- `packages/payments/src/processor.ts` interface — speculative; ship Stripe direct.
- CCBill / Verotel / Segpay adapters — not needed.
- The `web_ccbill | web_verotel | web_segpay` enum variants in the `rail` column.

## When to revisit

- If Lynk's surface ever broadens to include sexually-explicit creator content,
  re-open this memo. Stripe terminates on policy drift, not on intent.
- The processor abstraction can be added later behind a feature flag if a second web
  rail becomes business-relevant (e.g. expansion into a market Stripe doesn't serve).
  YAGNI today.
