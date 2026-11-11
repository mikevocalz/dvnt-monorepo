# Integrated payout draft file inventory

Complete payout-only diff against the verified master tree `a153580fb21436a3abd5ec408177ee541158eeff` (remote master `7298d4bd0966793d31a672734629e6e950f29e15`). Current non-payment release files are preserved. `A` means added; `M` means modified. No file is deleted. Local test outputs, generated Python caches, credentials and private evidence are not part of the change.

## CI workflows

- M `.github/workflows/verify-edge-functions.yml`

- A `.github/workflows/external-settlement-recording.yml`
- A `.github/workflows/payout-readiness.yml`
- A `.github/workflows/payout-release-safety.yml`
- A `.github/workflows/promoter-payout-journey.yml`
- A `.github/workflows/promoter-self-summary.yml`
- A `.github/workflows/settlement-concurrency.yml`

## Follow-up scanner and guard files

- M `scripts/verify-issuance-invariants.mjs`
- A `scripts/verify-issuance-invariants.test.cjs`
- A `scripts/test-settlement-checkout-duplicate-guard.cjs`

## Runbooks and scope

- M `apps/mobile/supabase/config.toml`
- A `docs/payments/SOURCE-ACCOUNTED-FUNDING.md`
- A `docs/payments/canceled-checkout-replacement-followup.md`
- A `docs/payments/checkout-settlement-liveness.md`
- A `docs/payments/external-promoter-recording-draft.md`
- A `docs/payments/legacy-recipient-visibility-gate.md`
- A `docs/payments/promoter-first-settlement.md`
- A `docs/payments/settlement-foundation-rollout.md`
- A `docs/payments/settlement-integrated-file-inventory.md`
- A `docs/payments/settlement-outflow-safety.md`
- A `docs/payments/settlement-publication-plan.md`
- A `docs/payments/settlement-recovery-safety.md`
- A `docs/payments/settlement-resume-checkpoint.md`
- A `docs/payments/settlement-runtime-validation.md`
- A `docs/runbooks/payout-readiness.md`
- M `docs/runbooks/payouts-release.md`

## Runtime and API

- A `apps/mobile/supabase/functions/_shared/checkout-charge-model.test.cjs`
- M `apps/mobile/supabase/functions/_shared/checkout-replay.test.cjs`
- A `apps/mobile/supabase/functions/_shared/legacy-ownership-summary.ts`
- A `apps/mobile/supabase/functions/_shared/legacy-promoter-rows.ts`
- M `apps/mobile/supabase/functions/_shared/organizer-refund-free-guard.test.cjs`
- A `apps/mobile/supabase/functions/_shared/owner-dispute-policy.test.cjs`
- A `apps/mobile/supabase/functions/_shared/owner-dispute-policy.ts`
- M `apps/mobile/supabase/functions/_shared/payment-safety.test.cjs`
- A `apps/mobile/supabase/functions/_shared/payout-readiness-sql.test.cjs`
- A `apps/mobile/supabase/functions/_shared/payout-readiness.test.cjs`
- A `apps/mobile/supabase/functions/_shared/payout-readiness.ts`
- A `apps/mobile/supabase/functions/_shared/promoter-payout-summary.ts`
- A `apps/mobile/supabase/functions/_shared/settlement-checkout.ts`
- A `apps/mobile/supabase/functions/_shared/settlement-engine.ts`
- A `apps/mobile/supabase/functions/_shared/settlement-funding.ts`
- A `apps/mobile/supabase/functions/_shared/settlement-readiness.test.cjs`
- A `apps/mobile/supabase/functions/_shared/settlement-readiness.ts`
- A `apps/mobile/supabase/functions/_shared/settlement-recovery.ts`
- A `apps/mobile/supabase/functions/_shared/settlement-routing.test.ts`
- A `apps/mobile/supabase/functions/_shared/settlement-routing.ts`
- A `apps/mobile/supabase/functions/_shared/settlement-status.ts`
- A `apps/mobile/supabase/functions/_shared/settlement-webhook-link.ts`
- M `apps/mobile/supabase/functions/_shared/ticket-sale-availability.test.cjs`
- M `apps/mobile/supabase/functions/bulk-refund-tickets/index.ts`
- M `apps/mobile/supabase/functions/cart-checkout/index.ts`
- M `apps/mobile/supabase/functions/cart-line-refund/index.test.cjs`
- M `apps/mobile/supabase/functions/cart-line-refund/index.ts`
- M `apps/mobile/supabase/functions/create-payment-intent/index.ts`
- M `apps/mobile/supabase/functions/db-health/index.ts`
- A `apps/mobile/supabase/functions/db-health/payout-readiness.test.cjs`
- M `apps/mobile/supabase/functions/delete-account/index.ts`
- M `apps/mobile/supabase/functions/event-analytics/index.ts`
- M `apps/mobile/supabase/functions/event-cancel/index.test.cjs`
- M `apps/mobile/supabase/functions/event-cancel/index.ts`
- M `apps/mobile/supabase/functions/guest-checkout/discounts-fixture.cjs`
- M `apps/mobile/supabase/functions/guest-checkout/index.ts`
- M `apps/mobile/supabase/functions/organizer-refund/index.ts`
- M `apps/mobile/supabase/functions/payouts-release/index.ts`
- A `apps/mobile/supabase/functions/payouts-release/safety.test.cjs`
- A `apps/mobile/supabase/functions/payouts-release/safety.ts`
- A `apps/mobile/supabase/functions/promoter-self/index.test.cjs`
- M `apps/mobile/supabase/functions/promoter-self/index.ts`
- A `apps/mobile/supabase/functions/record-external-promoter-payment/index.ts`
- A `apps/mobile/supabase/functions/settlements-process/index.ts`
- M `apps/mobile/supabase/functions/stripe-webhook/index.ts`
- M `apps/mobile/supabase/functions/ticket-checkout/index.ts`
- M `apps/mobile/supabase/functions/ticket-refund/index.test.cjs`
- M `apps/mobile/supabase/functions/ticket-refund/index.ts`
- M `apps/mobile/supabase/functions/ticket-refund/test-fixture.cjs`

## Database artifacts

- A `apps/mobile/supabase/migrations/20261111010000_payout_readiness_observability.sql`
- A `apps/mobile/supabase/migrations/20261111040111_settlement_runtime_v1.sql`
- A `docs/payments/drafts/settlement-external.sql`
- A `docs/payments/drafts/settlement-funding.sql`
- A `docs/payments/drafts/settlement-ledger.sql`
- A `docs/payments/drafts/settlement-legacy-ownership.sql`
- A `docs/payments/drafts/settlement-observability.sql`
- A `docs/payments/drafts/settlement-outflows.sql`
- A `docs/payments/drafts/settlement-preflight.sql`
- A `docs/payments/drafts/settlement-recovery.sql`
- A `docs/payments/drafts/settlement-release-policy.sql`
- A `docs/payments/drafts/settlement-runtime.sql`
- A `docs/payments/drafts/settlement-watchdog.sql`

## UI and client contracts

- M `packages/app/features/events/analytics.web.tsx`
- M `packages/app/features/events/promoter-self.web.tsx`
- M `packages/app/features/routes/screens/(protected)/events/[id]/analytics.tsx`
- M `packages/app/features/routes/screens/(protected)/events/[id]/promoter.tsx`
- M `packages/app/lib/api/event-analytics.ts`
- M `packages/app/lib/api/promoters.ts`
- A `packages/app/lib/hooks/use-promoter-payout.ts`
- M `packages/app/lib/hooks/use-ticket-checkout.ts`
- A `packages/app/lib/payments/legacy-ownership-status.ts`
- A `packages/app/lib/payments/promoter-payout-status.test.ts`
- A `packages/app/lib/payments/promoter-payout-status.ts`
- A `packages/app/lib/payments/settlement-status.test.ts`
- A `packages/app/lib/payments/settlement-status.ts`

## Tests and build tools

- A `scripts/build-settlement-migration.mjs`
- A `scripts/fixtures/settlement/approved-policy.sql`
- A `scripts/fixtures/settlement/external-schema.sql`
- A `scripts/fixtures/settlement/schema.sql`
- A `scripts/test-external-settlement-concurrency.py`
- A `scripts/test-promoter-first-budget.cjs`
- A `scripts/test-promoter-payout-ui.cjs`
- A `scripts/test-settlement-buffer.cjs`
- A `scripts/test-settlement-checkout-liveness.cjs`
- A `scripts/test-settlement-concurrency.py`
- A `scripts/test-settlement-endpoint.cjs`
- A `scripts/test-settlement-engine.cjs`
- A `scripts/test-settlement-external-endpoint.cjs`
- A `scripts/test-settlement-external.cjs`
- A `scripts/test-settlement-funding.cjs`
- A `scripts/test-settlement-ledger.cjs`
- A `scripts/test-settlement-legacy-ownership.cjs`
- A `scripts/test-settlement-migration.cjs`
- A `scripts/test-settlement-outflows.cjs`
- A `scripts/test-settlement-recovery.cjs`
- A `scripts/test-settlement-release-policy.cjs`
- A `scripts/test-settlement-runtime.cjs`
- A `scripts/test-settlement-webhook-link.cjs`

Total: 120 changed paths. The PR commit/tree and required exact-head CI are verified separately; this inventory is not production authorization.
