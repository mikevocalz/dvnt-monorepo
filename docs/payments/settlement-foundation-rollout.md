# Settlement foundation: draft, not an enabled payout system

This change does **not** initiate a transfer, reverse a historical charge, make a bank payout, install a schedule, apply a migration, or change live configuration.

## What is implemented

- All four current paid checkout rails explicitly persist `destination_charge`: ticket-checkout, guest-checkout, create-payment-intent, cart-checkout. Hosted sessions stamp both session and PaymentIntent metadata. The order must persist before the handler returns a payment URL or secret. Cart replay rejects a conflicting known model.
- `settlement-routing.ts` is a pure, **unwired** contract for a future checkout adapter. Separate-charge parameters omit both destination and application fee. The gate defaults to destination and requires durable order/allocation state, reviewed rollout, refund/dispute interlock and source reconciliation. Retries cannot switch models with today's flag.
- `drafts/settlement-ledger.sql` is executable locally for review, **outside the migration directory**. It defines private service-only immutable per-order/recipient allocations, locked financial snapshots, held deliveries, stable idempotency keys, reservations, per-order refund/dispute holds, and exact-evidence transfer reconciliation. No application adapter or release/unblock API exists yet.
- A reservation is durable before any future network request. Reserved or uncertain work cannot be reserved again. Reconciliation must match charge, currency, amount, destination, and unique transfer identity. Partial completion never resets already-transferred allocations. Recipient onboarding can complete later without reallocating their earnings. Destination binds at reservation and cannot be changed on retry.
- Refund/dispute holds are **per order**, not event-wide. This supports a narrowly approved platform-owner exception for unaffected orders without allowing disputed dollars to fund other recipients. The ledger does not decide trusted owner identity or authorize that exception.
- A transfer moves money to a connected Stripe balance. It never means bank-paid: every tested transfer leaves `bank_payout_state = unverified`.

## Required before enabling separate charges or transfer execution

1. Review and combine the independent payout safety and owner-policy drafts. The old event-wide sweep must never process the new ledger's orders or repeat destination-funded transfers. Keep all execution disabled during coexistence.
2. Build a durable checkout enrollment adapter across all four rails, paid-cart atomic SQL, webhook/reconciliation fallback paths, and embedded checkout. Lock charge model before creating payment objects; use immutable per-attempt identifiers and database compare-and-swap, not a read-then-write race. Never trust request or Stripe metadata as source-funding proof.
3. Verify succeeded platform charge, PaymentIntent, amount/currency, captured amount, no automatic destination transfer, fees/reserves, actual available funds, and connected-recipient identity/capabilities. The draft enrollment function trusts its service adapter's verified evidence; it cannot query Stripe. Release time currently defaults to review-held even after enrollment. Build an audited release decision and approval evidence, not a manual blanket unblock.
4. Complete refund/dispute integration **before network actions**: atomically acquire the same order lock and place the hold before issuing refunds; verified webhook updates and reservation/reconciliation must use the same lock order. A race after dispatch records recovery, not a pretend cancellation. Build proportional refund allocation, idempotent reversal intents keyed by refund, recovery obligations for short recipient balances, and human-reviewed won-dispute release. The draft conservatively quarantines; it does not implement automatic reversals or release.
5. Build a crash-safe transfer adapter with exact payload fingerprints, source_transaction and persisted idempotency keys; verified reconciliation for lost responses and DB failures; never blindly retry an ambiguous attempt after Stripe's idempotency retention. Validate account mapping at reservation and leave incomplete onboarding held. No production adapter exists in this draft.
6. Build verified connected-account payout webhooks and reconciliation, including failures/reversals and attribution of aggregate bank payouts. Never equate transfer success with bank settlement.
7. Convert reviewed SQL using `supabase migration new`, apply only in an explicitly authorized isolated environment, exercise concurrent transactions on PostgreSQL, run advisors/RLS tests and Stripe sandbox integration tests. No CLI migration was created or live schema applied here.
8. Approve operational ownership, funds/reserves, capability checks, alerting, reconciliation, release thresholds, kill switches and rollout. Only then enable a narrowly scoped checkout cohort. Scheduling remains off until verified ledger evidence shows safe settlement.

## Existing-order and compatibility boundaries

Historical NULL/destination-funded orders cannot enroll. No backfill, ownership exception or changed feature flag creates platform funds. Historical recovery/funding and any actual payment remain separate approved financial operations.

Adding metadata to the cart's existing Stripe idempotency key can reject an in-flight pre-release retry with parameter mismatch. Keep the key, reconcile the existing PaymentIntent and drain old sessions before release; do not generate another key to bypass the mismatch. Existing NULL fallback rows remain unknown, not silently promoted to separate charges.

Checkout persistence failure withholds capability, but an already-created Stripe object may still exist. A subsequent cleanup/reconciliation workflow is required for orphaned objects; this draft does not claim to cancel them. The current cart read guard is not a substitute for immutable database charge-model enforcement once multiple live models exist.

## Validation

- `NODE_PATH=<local test deps>/node_modules node --test scripts/test-settlement-ledger.cjs`: actual PostgreSQL/WASM draft execution, immutable allocation/source economics, replay, amount conservation, role grants, disabled release, partial completion, late onboarding, exact reconciliation, refund/dispute interleavings, recovery and separate bank status.
- `node --test apps/mobile/supabase/functions/_shared/settlement-routing.test.ts`: routing and every rollout gate.
- `NODE_PATH=<local test deps>/node_modules node --test apps/mobile/supabase/functions/_shared/checkout-charge-model.test.cjs apps/mobile/supabase/functions/_shared/payment-safety.test.cjs apps/mobile/supabase/functions/guest-checkout/*.test.cjs`: checkout handler regression tests.

Tests use synthetic fixtures and local mocks only. PostgreSQL/WASM interleaving tests do not prove cross-process lock behavior or remote Stripe outcomes. No sandbox/account was created. These checks do not constitute a complete monorepo lint/typecheck/build or end-to-end live payout validation.
