# Settlement runtime: offline draft, all execution disabled

The code is more than a foundation, but is **not approved for production rollout**. No production migration, deployment, schedule, account setting, funds movement, or live data correction is part of this change.

## Implemented in the draft

- Durable charge-model and economic snapshots across four paid checkout rails. Never-cutover events retain destination checkout; permanently cutover events pause if the new-model execution gates are off. Unsupported paid door, embedded and upgrade paths are denied after cutover.
- Immutable recipient allocations, source-charge verification, funding epochs, reserved/uncertain delivery accounting, per-currency risk reserves and promoter-first organizer release. A promoter bank deposit is not required to unlock its organizer allocation; exact confirmed transfer or reviewed external-settlement evidence is required.
- Refund interlocks, durable outflow reservation/reconciliation, provider-backed reversal recovery, and verified connected-account bank-payout membership. Unknown transfer or refund outcomes remain held rather than blindly retried.
- Explicit reviewed event cohorts and release policy: canonical end is end_date, otherwise start_date + six hours; add five weekdays in the reviewed timezone. Original checkout release, current rescheduled release and an explicit later payout_release_at form a not-before maximum. No cohort or timezone is implicitly approved.
- Read-only missing/never-successful/stale worker alerts, scheduler inventory, private manual-review queues, and distinct setup, transfer and bank delivery UI. Frozen actor-owned new allocations and external legacy receipts remain visible, including summary-only history for removed/reassigned promoters. Plain legacy earnings/referral totals have no immutable actor evidence and are explicitly unavailable pending ownership review, never reassigned to the current roster owner or reported as zero.
- Canonical atomic issuance receipts before source enrollment or any new transfer reservation. Captured payment without complete ticket/cart entitlements remains recoverable and cannot become payout authorization. Hosted final tax/PaymentIntent binding is verified before issuance.
- Explicit canceled-attempt replacement uses authenticated owner or volatile guest recovery capability, fresh price/tax review, one successor, retained inventory and separately gated cleanup. Failed/unknown dispatch never permits a fresh automatic charge.
- Mandatory configured worker admission budget with a durable five-phase cursor. In-item budget exhaustion persists attention without clearing financial claims; ordinary between-item deferral stays quiet.
- Reproducible ordered SQL assembly at scripts/build-settlement-migration.mjs, with source-schema preflight. The generated migration installs no schedule and enables no execution, cohort or reserve policy.

## Checkout routing and irreversible event cutover

The reviewed event release/cohort policy is now the checkout routing authority.
Installing the schema with its empty policies leaves never-cutover events on
legacy destination checkout. Adding an event's reviewed policy permanently
records its separate-charge cutover. Removing that policy, changing request
keys, switching hosted/native/cart rails, or turning the deployment flag off
cannot return that event to legacy payment creation. A cutover event with its
deployment or database checkout gate off is paused; unrelated never-cutover
events remain on the legacy rail. The model flag is not an app-wide kill switch.

The new routing RPC is a deployment dependency. Missing schema, stale RPC cache,
malformed routing data and database failures fail closed, including PGRST202.
Install and verify the backward-compatible empty-policy migration before
deploying these adapters. Do not deploy the new adapter against an old schema
and expect a permissive fallback.

Before changing an event's cohort, quiesce that event's checkout entrypoints,
drain all already-running legacy requests and reconcile their provider results,
then commit the reviewed policy/fence and enable the prepared new-model path.
The route read cannot retroactively stop a legacy request admitted before that
commit. The native race fixture deliberately demonstrates that boundary; it is
not an atomic mixed-model transition guarantee. No drain controller or live
cutover is installed by this draft. Never remove the permanent fence to recover
from a rollout problem; keep the affected event paused and reconcile instead.

## Execution flags do not make a read-only diagnostic

`processSettlementOrder(..., { execute: false })` suppresses new provider transfer creation, but it still verifies and records source evidence, requires an existing canonical issuance receipt before it can enroll immutable allocations and update reconciliation state. The worker also leases queues and persists observations. It is not a read-only dry run and must not be invoked against production under read-only diagnostic authority. Tests here use disposable local data. Use only the documented snapshot/summary SELECT RPCs for authorized read-only inspection; obtain separate approval for any live reconciliation writes.

## Release gates, in order

1. Review the complete generated migration on the exact intended base, all role grants, real source schema, actual constraints and existing triggers. A synthetic schema test is not proof of live compatibility. Do not apply an earlier empty migration or independent fragments out of order. Check deployed migration history: if this version was ever recorded when empty, stop and prepare a separately reviewed forward migration instead of silently rewriting or forcing migration history. Obtain explicit production migration/deployment approval separately.
2. Run isolated native PostgreSQL cross-process CI on the final commit. PostgreSQL-in-WASM covers SQL behavior, not independent session locking. The native runner refuses anything except an explicitly selected disposable CI database.
3. Prove new-account onboarding and all enabled checkout/refund/worker/reconciliation paths in an isolated Stripe sandbox. Provider end-to-end verification has not been performed for this artifact and requires separately authorized, positively identified sandbox access. Never use live financial actions or flip mode to fill this gap. Read-only compatibility checks of existing accounts do not prove new onboarding or transfer/bank lifecycle behavior. Test lost replies, provider rejection, refunds, reversals and aggregate payout attribution.
4. Approve each event cohort, release-policy interpretation/timezone and risk reserve per currency. There is no default safe risk reserve. Missing policy, source evidence, account readiness or currency funding fails closed. Never-cutover events outside the reviewed cohort retain legacy checkout; previously cutover events remain fenced and pause when their policy is unavailable.
5. Reconcile actual platform funds, existing liabilities and destination-funded legacy orders. Legacy/manual/provider-dashboard refunds, chargebacks and other balance movements can occur outside the new ledger. Their exposure needs an operational funding gate; this code is not a guarantee against every external balance change.
6. Keep the legacy event sweep from double-funding or marking new-model orders paid. Do not backfill destination/unknown sources into the new ledger. Reviewed external receipts never fabricate a Stripe transfer or bank payout, and later refunds/disputes create manual external recovery review.
7. Verify worker environment gates, source/account capabilities, cron inventory, one observed successful run, independent dead-man coverage, alert routing and controlled alert recovery. A schedule row is inventory, not proof that the secret, worker or notification destination works. Do not enable payments just to silence alerts.
8. Obtain explicit approvals for deployment, migration, scheduling/settings, funding and financial execution. Begin only with a narrow reviewed cohort, clear operator ownership and kill switches. Measure the actual host invocation limit and provider latency before configuring SETTLEMENT_RUN_BUDGET_MS. The worker rotates refund, recovery, bank, order and cleanup phases durably and rejects new provider admissions near its configured budget. This is not a hard process deadline: database writes are not forcibly canceled, and indivisible proofs must fit the supported budget. Slow-provider and worst-case backlog tests must demonstrate progress within the host invocation limit and observation cadence before enabling a pilot. See settlement-worker-budget.md.

## Legacy display rollout gate

Do not deploy the historical-total display change until affected open legacy obligations have independently reviewed frozen recipient identity and the default-empty actor-scoped legacy bridge is provisioned through authorized reconciliation. Plain legacy ownership cannot be inferred from the current promoter assignment, and an unpaid obligation must never be fabricated as an external payment to create evidence. See legacy-recipient-visibility-gate.md for the explicit compatibility impact and reviewed bridge.

## Manual boundaries

Won disputes stay held pending reviewed provider evidence and policy. Lost chargebacks cannot be fabricated as successful Refund objects: dispute/refunded states and transferred allocations without recovery evidence appear in a typed manual-review queue. External-paid refunds require manual external recovery, not fictitious Stripe reversals. Unknown partial-cart refund allocation, source audit limits, stale proof and uncertain provider outcomes remain quarantined.

No automatic recovery claim applies to these cases. Transfer success is not bank payment. Gross transfer amounts and verified net bank contribution remain separate.

## Verification

Run the checked-in offline runner and the native PostgreSQL workflow on the exact final commit. See settlement-runtime-validation.md for commands and actual results. No sandbox/live financial execution, full monorepo build/typecheck, production schema application, alert-delivery proof or deployment is implied by focused green tests.

## Additional funding blockers

A platform automatic bank sweep can withdraw money despite database reserves. The draft executor reads platform account payout settings before each new transfer and only permits a verified manual schedule; automatic, missing or unreadable settings hold and alert. It does not change the schedule, stop an already-started payout, prevent a manual withdrawal, or physically segregate funds. Supporting a minimum-balance policy instead requires a separately verified implementation and approval. See Stripe's supported existing-platform settings contract: https://docs.stripe.com/connect/manage-payout-schedule.

The source-accounted funding layer excludes every unrecognized positive provider transaction, including a paid charge whose webhook has not reached the database. Exact available charge receipts, an immutable reviewed cutover policy and a fresh bounded audit are required before reservation. All observed negative transactions remain deducted. Pending/abandoned checkouts add no credit or permanent encumbrance. See SOURCE-ACCOUNTED-FUNDING.md for accounting, the missing-webhook tests and mandatory cutover, audit-volume, holding-period and external-debit limitations. Final native concurrency and provider sandbox verification remain required; this is not a guarantee against provider-side spending after an audit.

## Explicit canceled-checkout replacement

The assembled draft now includes default-off owner/guest recovery, fresh quote acceptance, immutable cart revisions, one-successor/provider dispatch, retained inventory and separately gated cancellation reconciliation. Supported catalog limits and mandatory native/provider/operational gates are listed in canceled-checkout-replacement-implementation.md. The financial transfer flag does not control cleanup cancellations; never describe a transfer-disabled worker as read-only.

## Provider smoke boundary

Separate dedicated-sandbox payment/refund primitives have been exercised, but the synthetic recipient remains restricted pending onboarding. No transfer/reversal/bank-payout or repository adapter/worker end-to-end proof exists from that smoke. Keep all runtime execution and rollout approvals gated independently.

The combined baseline originally held every legacy-only v2 error. This isolated follow-up adds a separately classified, exact-error-only US/USD **test-mode-only** legacy proof path. It preserves v2 readiness gates and rejects missing ownership, requirements, bank or mode evidence. Live legacy accounts remain held. The actual observed list fixture is unbound and still rejected; exact configured-version provider GET and lifecycle verification remain outstanding. See [legacy-recipient-compatibility.md](legacy-recipient-compatibility.md). Generic network, authentication or restricted-capability errors never authorize fallback.
