# Promoter-first settlement contract (draft, default off)

This contract originated in the paused `f38034ca` source slice and is now included in the complete master-based draft. It changes no production settings, schema, schedules or funds. The combined migration is assembled, but provider, native-CI, ownership reconciliation and rollout gates remain mandatory; see settlement-foundation-rollout.md and settlement-runtime-validation.md.

## Ordering and meaning of completion

Each new separate-charge order freezes its promoter identity, commission and organizer remainder before the provider payment is created. A commission is an accounting liability, not a separate Stripe escrow account. Only a successfully paid, verified separate platform charge may enroll in source-backed transfer allocations. Pending/failed payments do not create spendable money.

The executor attempts the promoter allocation first, regardless of database result ordering. The database independently locks the source order and requires verified promoter completion before reserving that order's organizer remainder. A missing recipient account, restricted capability, failed verification, funding shortage, reserved attempt, ambiguous timeout or recovery obligation blocks that order's organizer allocation. It never erases or reallocates the commission. Unrelated healthy orders, including those in the same event, are not subject to a new whole-event hold.

Completion here means the exact, unreversed Stripe transfer has been verified into the intended connected account's balance. It does **not** mean the recipient's bank received money. Verified automatic-payout membership and bank status remain separate. Standard payout timing, onboarding restrictions and bank delays still apply; there is no guarantee of instant bank payment. A stricter bank-paid-before-host policy would be a different reviewed decision.

The external-settlement extension may replace `dvnt_settlement.promoter_obligation_satisfied(uuid)` with an exact immutable, reviewed, completed-payment proof. It must match the order, frozen promoter, currency and full allocation amount and reject recovery/held orders. It must not invent Stripe transfer IDs. The allocation JSON exposes `obligation_satisfied`; the executor skips already satisfied held promoter allocations. The external extension also independently forbids another promoter reservation. Host allocation amounts never increase after an external payment.

## Funds that a reservation cannot consume

While holding the currency-wide budget mutex, the public reservation RPC subtracts:

1. All reserved and uncertain transfer amounts, regardless of recipient.
2. Held unpaid promoter allocations from other new-model orders, including unavailable recipients and held/refund cases. An allocation is counted only once.
3. Frozen commissions for successfully paid new-model checkouts not enrolled yet, closing the payment-webhook-to-enrollment gap.
4. Outstanding attempted/uncertain/submitted refund debit intents and dispute outflow reviews.
5. An explicitly reviewed per-currency platform risk reserve in `currency_reserves`.

The allocation being claimed is then added to this protected total. Missing reserve configuration fails closed. No production reserve amount or fee rate is embedded in this draft. A synthetic zero reserve in regression fixtures is not a production recommendation.

The platform risk policy must account for applicable taxes, delayed Connect or other account fees, refunds, disputes and negative-balance exposure, as well as existing unrelated commitments. Source verification still requires the charge's actual available net after its processing fee to cover distributable proceeds plus tax. It never assumes the advertised card rate is the account's realized cost. Source funding, account ownership, capability, charge model, currency, amount and untracked prior transfers are rechecked before each send.

A funding epoch invalidates stale balance observations when a new-model order's money status changes, its liability moves from paid checkout to enrolled allocation, or a transfer is confirmed. Enrollment takes the same source-order then budget locks even if a webhook already marked the order paid, so another claim cannot observe a gap between those two liability representations. Unknown provider outcomes keep their reservation; a list with zero matches is not permission to resend. This database budget serializes this worker's claims. It cannot prevent an unrelated dashboard action, legacy executor, provider fee or platform automatic payout from spending the same Stripe balance outside the protocol. Rollout must reconcile those outflows and provision adequate available funds and platform retention. This is not a bank-level funds guarantee.

## Refunds, disputes and historical debt

The existing order/refund/dispute interlocks remain. A refund or order dispute before reservation blocks it. A hold after reservation preserves an unknown outcome; confirmed transfers become recovery obligations. A later source verification or won-dispute event cannot clear that hold automatically. Promoter completion does not override recovery holds. Existing bounded refund allocation and reversal reconciliation remain the recovery path.

The narrowly scoped platform-owner dispute-only exception is preserved. It never bypasses order-level holds, manual/recovery event stops, cancelled events, funding checks or source verification. There is no new blanket owner-event hold.

Historical destination-funded charges and missing charge-model rows remain ineligible for enrollment. Their promoter backlog was not retained by this new checkout model and is **not** automatically funded or protected by these allocations. Resolution requires separate verified funding, reconciliation and approved external-payment or recovery workflow; new-order reserves must not silently cure historical deficits.

## Validation and rollout gates

The synthetic SQL/engine tests cover frozen checkout commission, promoter-first database enforcement, delayed onboarding, same-event independent orders, global commission protection, the pre-enrollment gap, missing/risk reserve policy, stale funding epochs, negative funds, exact account ownership, source processing-fee shortage, destination-funded exclusion, overlapping workers, unknown outcomes, refunds/disputes and bank-status separation.

Native PostgreSQL cases also cover promoter-claim versus organizer reservation and promoter-confirmation versus stale organizer balance reads. A local PGlite pass does not certify cross-process locks; require the exact commit's isolated PostgreSQL CI result. No live or Stripe-sandbox financial calls are part of these tests.

Before enabling anything: integrate the external proof extension, assemble and verify the combined migration against the real schema, approve release timing and reserve policy, verify watchdog/alert routing and all checkout rails, test provider contracts in an authorized sandbox, reconcile historical liabilities and competing platform outflows, and review migration/deployment/schedule provisioning separately. All execution flags remain off by default.

### Integrated cross-order refund outflow protection

The complete draft now includes durable refund debit intents across all six transports, retained uncertain/submitted amounts, a shared currency budget mutex and epoch invalidation at start and verified completion. See settlement-outflow-safety.md. The isolated source slice alone must not be enabled. Final assembled native CI tests cover refund-start/completion versus host reservation; a fixed reserve or epoch-only patch is not the protection.

The integrated source-accounted layer additionally rejects unknown positive inflows, including provider-paid/database-pending charges, requires immutable available source receipts, persists observed negative transactions and caps every reservation by a fresh audited budget. See SOURCE-ACCOUNTED-FUNDING.md for exact accounting and remaining provider/cutover/scale limitations. Neither ledger is physical segregation.
