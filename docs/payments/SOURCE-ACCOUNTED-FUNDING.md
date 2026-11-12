# Source-accounted settlement funding (draft, default off)

## What this closes

A Stripe charge can become paid and available before its webhook changes the order from payment-pending. Reserving only enrolled or DB-paid commissions does not protect that inflow: another host could spend it. Pending checkout holds are not a safe alternative because abandoned attempts could consume the entire budget indefinitely.

The executor now recognizes **zero funds from unknown positive balance transactions**. A missing webhook, lost checkout response, pending payment, failed payment, expired session or abandoned checkout does not add funds or reserve funds. Read-only reconciliation can eventually verify a succeeded separate charge and enroll its frozen recipients/economics. The charge's actual available balance transaction then becomes an immutable source credit. No age/TTL establishes that an uncertain payment failed.

## Accounting

For one currency, the database computes:

`source cap = max(0, min(provider available before and after audit, recognized source net minus tax minus all observed debit net))`

Let `required` be the proposed payout plus held promoter commissions, DB-paid unenrolled commissions, pending/uncertain transfers and durable refund/dispute intents. Every reservation must satisfy **both** `required <= source cap` and `required + reviewed risk floor <= actual audited provider available`. Unknown positive inflows never authorize payouts, but additional actual available funds can satisfy the buffer inequality. This does not prove that the extra balance is economically independent capital; capital provenance, pre-cutover liabilities and segregation remain separately reviewed operational gates. For example, recognized proceeds of 1,000, a payout of 900, actual available funds of 1,400 and a risk floor of 400 pass both limits. The floor is not deducted twice.

The public wrapper authenticates the unchanged source cap. Only its private inner call receives `min(actual available, authenticated source cap + current floor)`; the inner implementation subtracts that identical floor and the existing liabilities. This is algebraically equivalent to the two limits without duplicating commission/refund accounting. That adjusted value is never stored or returned as a source credit. Reviewed risk-policy INSERT, UPDATE and DELETE statements take the controls mutex before modifying policy rows and invalidate old audit epochs, so a floor cannot change between the two reads. TRUNCATE is rejected immediately without acquiring that mutex because PostgreSQL already holds an exclusive relation lock before its trigger runs; use reviewed DELETE for removal.

The promoter obligation on the same order must still be satisfied before the host remainder. A promoter with incomplete onboarding remains protected.

- Source recognition requires exact order/charge/balance-transaction identity, currency, gross, actual fee, actual net, available status and frozen tax. The adapter verifies the succeeded PaymentIntent and separate charge; metadata is not sufficient. SQL checks the enrolled source and immutable proof again.
- Charge fees are already included in the source transaction's net. They are not deducted a second time.
- Every negative transaction counts, including transfers, refunds, payouts, Stripe fees, Connect collections and adjustments. **Pending negative transactions count immediately.** Debit identity and net are immutable, and a later available status neither releases nor doubles the debit.
- Unknown positive transactions, top-ups, reversal proceeds and refunds of fees add zero. This is deliberately conservative. There is no unreviewed “opening balance” or top-up shortcut.
- Historical destination-funded charges cannot be recognized as new separate-charge sources. Existing transfer auditing and unique source transaction identity prevent a prior transfer or replay from becoming a second source credit.
- A refund or unknown transfer can temporarily be counted both as a provider debit and as a DB reservation until exact reconciliation. This favors safety over availability. A successful provider credit by itself never clears an uncertain obligation.

## Provider read and DB concurrency contract

1. Fetch the platform account (no connected-account header); keep the existing read-only manual payout schedule guard.
2. Read the DB funding epoch, server observation time and immutable funding policy (platform account ID, live/test mode, audit-from timestamp).
3. Read platform available balance, exhaust `/v1/balance_transactions?created[gte]=EPOCH&limit=100` with `starting_after`, and repeat the first page. Any duplicate, malformed row, incomplete page, changed head or changed head pagination flag fails closed. Read available balance again and use the lower ceiling.
4. Commit the audit under the global funding mutex. SQL computes recognized credits from immutable source receipts and all durable observed debits. New source receipts, newly observed debits, enrollment and completed money movement invalidate old epochs. Older audits cannot replace newer observations.
5. The public reserve wrapper checks a fresh audit, exact currency and the current epoch under order-then-controls locks, and forbids any requested available amount above the audited cap. Its inner reservation retains the existing commission, refund, risk, external-proof and idempotency checks. Private entrypoints, including the renamed wrapper, are not executable by service_role or clients.

All timeouts expire *permission to spend*, never uncertain liabilities. The 60-second source/audit window is not proof of payment cancellation. All provider actions in this change are reads; existing transfer dispatch remains separately gated off by default.

## Mandatory rollout gates and limitations

This is an initial, bounded audit implementation, not a claim that production is ready or funds are physically segregated.

- Install the funding source **last** in the assembled migration. Seed no production policy in the artifact. The policy is immutable, has no app write RPC and must be reviewed before enabling checkout. Its epoch must precede every funded source and the first enabled cohort checkout.
- The accounting begins with **zero recognized opening funds**. Independently reconcile and document pre-cutover pending debits, payout instructions, refunds, chargebacks, account reserves and legacy transactions that can settle after cutover. A created-time query cannot discover pre-epoch pending liabilities. These must be resolved or explicitly covered by a reviewed per-currency reserve before enabling anything. Do not declare the cutover safe from an empty DB alone.
- Legacy debits after cutover are charged against this conservative pool, while legacy positive credits stay excluded. This can block otherwise affordable payouts. Resolve the accounting/funding constraint under review; do not bypass it by changing the epoch or trusting a raw available balance.
- Audits are bounded to 100 pages / 10,000 transactions and must finish within the 60-second DB window. At either bound the allocation stays held, with `source_audit_limit` or the existing funding/verification error visible to operations. There is **no automatic checkpoint roll-forward**. A dated, volume-bounded pilot and capacity alert/runbook are required. Sustained production traffic needs a reviewed incremental ledger/checkpoint design or another provider funding mechanism before the bound is reached. Never advance `audit_from` to discard history.
- Ordinary platform funds remain fungible. Provider/dashboard debits and automatic bank sweeps are outside database locks. Head stability and before/after available reads reduce the observation gap but cannot prevent a new provider debit after the final read, or a debit whose effect is obscured by a simultaneous unknown credit. The manual schedule guard alone is not physical segregation. Reconcile all provider-side permissions and sweep controls, retain sufficient independent risk capital, and confirm the provider capability before promising stronger protection.
- Holding money indefinitely is not permitted merely because a DB liability is durable. Before rollout, verify the applicable platform and connected-account country, Stripe product/contract and maximum holding period. Check the proposed event-end-plus-five-business-days release date against the **checkout date**, include delayed/cancelled events and incomplete promoter onboarding, and approve only a dated cohort inside the supported horizon. Define escalation before the holding limit; never silently pay a host to clear the problem. No specific DVNT account holding period was verified by this engineering change.
- Stripe documents funds segregation as a private-preview mechanism that allocates charge funds outside the ordinary platform balance. It is not enabled, assumed available or implemented here. Enabling a new provider capability or changing payout schedules requires a separate authorized rollout.
- “Promoter transfer confirmed” means the connected-account balance received the transfer. Bank receipt still requires the existing payout-membership proof and must not be inferred from transfer success.

## Verification and integration

`NODE_PATH=/tmp/dvnt-payout-operations-deps/node_modules node --test scripts/test-settlement-funding.cjs` runs real SQL with a synthetic read/write provider. It covers the missing-webhook cross-order case, enrollment/epoch transition, processing/failure/cancellation, pending-to-available status without a new ID, abandoned-checkout volume, available-balance ceiling, currency isolation, taxes/fees, unknown credits/reversals, all debit types, duplicate/immutable proof, pending debit transition, refund/unknown transfer retention, ACL/raw-balance bypass, page limits and audit churn.

The updated native PostgreSQL fixture seeds a synthetic policy and records source/audit proof through the same RPCs, including provider-like transfer debit rows. Native overlapping-process tests must run against the final generated migration in disposable CI. Compiling the fixture is not proof that native races passed.

## Official provider references reviewed

- [Separate charges and transfers](https://docs.stripe.com/connect/separate-charges-and-transfers): source transaction limits and platform refund responsibility; grouping is not segregation.
- [Balance transaction list API](https://docs.stripe.com/api/balance_transactions/list): descending created-time pagination, 100-row limit, account balance transaction types.
- [Funds segregation](https://docs.stripe.com/connect/funds-segregation): private preview, allocated-fund behavior and compatibility constraints.
- [Manual payouts](https://docs.stripe.com/connect/manual-payouts): country-dependent holding limits, distinction between platform-to-connected transfers and bank payouts. This page concerns connected accounts; do not infer a DVNT platform-specific permission from it.
