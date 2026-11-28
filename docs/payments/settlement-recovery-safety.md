# Refund recovery and bank reconciliation safety

This implementation is draft-only until the combined migration and rollout review. It does not create a scheduler. Provider reversal execution requires both the caller's explicit enabled flag and the database `recovery_enabled` control; both default off.

## Refund paths

All six refund transports (buyer, organizer, cart-line, bulk, event cancellation, account deletion) resolve the actual order model and persist a separate-charge hold before posting a refund. Separate charges omit destination-charge-only `reverse_transfer` and `refund_application_fee` flags. Legacy destination behavior remains intact. A failed hold prevents the provider request.

Webhook refund/dispute events hold separate-charge orders before legacy bookkeeping. Separate-charge refunds and transfer reversals do not invoke the legacy whole-commission clawback. Dispute closure does not automatically release a hold.

The recovery scanner retrieves the actual PaymentIntent, charge and every refund page. A standalone ticket's complete refund maps to its frozen, discounted admission allocation by verified order, tier, ticket index and purchase amount. Buyer fees do not enter the eligible subtotal. Partial ticket amounts and cart/add-on partial refunds without immutable per-line eligible prices are recorded as quarantined. No proportional-gross estimate is substituted.

A fully settled full refund can recover the outstanding allocation remainder. Recovery amounts are locked per refund and allocation, cumulative rounding is deterministic, and the sum never exceeds the original allocation. Untransferred funds remain held. Previously transferred amounts create durable recovery obligations.

A reversal has one database claim and deterministic provider key. Timeout, provider rejection, insufficient recipient balance, or failed response persistence leaves an explicit uncertain obligation with its last error. It is not automatically retried. Read-only reconciliation must find exactly one reversal matching transfer, allocation, refund, amount and recovery metadata before resolving it. A missing reversal is not proof that another POST is safe.

## Bank status

A paid transfer does not imply a bank payout. Verification requires:

1. Exact platform transfer, recipient account and immutable allocation.
2. Its `destination_payment`, retrieved in that connected account.
3. The incoming balance transaction with the correct source, gross, net and currency.
4. That exact transaction in the fully paginated membership of an automatic payout in the same account.
5. The payout's current status.

`paid` means verified inclusion in a paid automatic payout batch. It is not a claim that an allocation's gross was deposited without fees. Proof retains both gross and net contribution. Manual or unproven payouts stay unverified.

Both `payout.paid` and `payout.reconciliation_completed` wake verification. A paid event alone cannot mark an allocation paid. Signed failed/canceled events persist even before the first proof; per-account database serialization prevents a concurrent paid proof from losing a failure. Older proof replays cannot resurrect a failed payout. A later payout must independently prove membership.

## Queue progress and limits

Refund, reversal-reconciliation and bank candidate pages receive durable five-minute leases before processing. Least-recently checked ordering lets later work advance past blocked first pages; crashes retry after lease expiry. Refund/payout signals wake relevant work immediately. Proven paid allocations and exact failed payout pairs retire from bank scanning.

Unmatched and pending bank pairs still retry after five minutes because Stripe membership can arrive later. An account with many unmatched historical payouts can create many candidate pairs; monitor queue lag and scan volume before scaling rollout. Provider pagination is bounded at 1,000 pages and incomplete results fail closed.

## Evidence

Run `scripts/test-settlement-recovery.cjs` with the existing PGlite/TypeScript dependencies. It covers actual SQL gates, bounded partial/full recovery, unknown allocations, uncertain reversals, bank proof and event ordering, access restrictions and fair queue progress. Refund endpoint regressions cover unchanged destination refunds, separate-charge flags, and hold failure preventing payment activity. Native PostgreSQL concurrency tests independently exercise bank failure/proof races.
