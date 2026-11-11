# Settlement runtime: offline draft, all execution disabled

The code is more than a foundation, but is **not approved for production rollout**. No production migration, deployment, schedule, account setting, funds movement, or live data correction is part of this change.

## Implemented in the draft

- Durable charge-model and economic snapshots across the four paid checkout rails, defaulting to the existing destination-charge path while the new model is disabled.
- Immutable recipient allocations, source-charge verification, funding epochs, reserved/uncertain delivery accounting, per-currency risk reserves and promoter-first organizer release. A promoter bank deposit is not required to unlock its organizer allocation; exact confirmed transfer or reviewed external-settlement evidence is required.
- Refund interlocks, durable outflow reservation/reconciliation, provider-backed reversal recovery, and verified connected-account bank-payout membership. Unknown transfer or refund outcomes remain held rather than blindly retried.
- Explicit reviewed event cohorts and release policy: canonical end is end_date, otherwise start_date + six hours; add five weekdays in the reviewed timezone. Original checkout release, current rescheduled release and an explicit later payout_release_at form a not-before maximum. No cohort or timezone is implicitly approved.
- Read-only missing/never-successful/stale worker alerts, scheduler inventory, private manual-review queues, and distinct setup, transfer and bank delivery UI. Frozen actor-owned new allocations and external legacy receipts remain visible, including summary-only history for removed/reassigned promoters. Plain legacy earnings/referral totals have no immutable actor evidence and are explicitly unavailable pending ownership review, never reassigned to the current roster owner or reported as zero.
- Reproducible ordered SQL assembly at scripts/build-settlement-migration.mjs, with source-schema preflight. The generated migration installs no schedule and enables no execution, cohort or reserve policy.

## Execution flags do not make a read-only diagnostic

`processSettlementOrder(..., { execute: false })` suppresses new provider transfer creation, but it still verifies and records source evidence, can mark the public order paid, enroll immutable allocations and update reconciliation state. The worker also leases queues and persists observations. It is not a read-only dry run and must not be invoked against production under read-only diagnostic authority. Tests here use disposable local data. Use only the documented snapshot/summary SELECT RPCs for authorized read-only inspection; obtain separate approval for any live reconciliation writes.

## Release gates, in order

1. Review the complete generated migration on the exact intended base, all role grants, real source schema, actual constraints and existing triggers. A synthetic schema test is not proof of live compatibility. Do not apply an earlier empty migration or independent fragments out of order. Check deployed migration history: if this version was ever recorded when empty, stop and prepare a separately reviewed forward migration instead of silently rewriting or forcing migration history. Obtain explicit production migration/deployment approval separately.
2. Run isolated native PostgreSQL cross-process CI on the final commit. PostgreSQL-in-WASM covers SQL behavior, not independent session locking. The native runner refuses anything except an explicitly selected disposable CI database.
3. Prove new-account onboarding and all enabled checkout/refund/worker/reconciliation paths in an isolated Stripe sandbox. The connected provider links currently expose live context only; sandbox verification is blocked pending separately authorized dedicated sandbox access. Never use live financial actions or flip mode to fill this gap. Read-only compatibility checks of existing accounts do not prove new onboarding or transfer/bank lifecycle behavior. Test lost replies, provider rejection, refunds, reversals and aggregate payout attribution.
4. Approve each event cohort, release-policy interpretation/timezone and risk reserve per currency. There is no default safe risk reserve. Missing policy, source evidence, account readiness or currency funding fails closed. Events outside the reviewed cohort remain on the disabled new-model path.
5. Reconcile actual platform funds, existing liabilities and destination-funded legacy orders. Legacy/manual/provider-dashboard refunds, chargebacks and other balance movements can occur outside the new ledger. Their exposure needs an operational funding gate; this code is not a guarantee against every external balance change.
6. Keep the legacy event sweep from double-funding or marking new-model orders paid. Do not backfill destination/unknown sources into the new ledger. Reviewed external receipts never fabricate a Stripe transfer or bank payout, and later refunds/disputes create manual external recovery review.
7. Verify worker environment gates, source/account capabilities, cron inventory, one observed successful run, independent dead-man coverage, alert routing and controlled alert recovery. A schedule row is inventory, not proof that the secret, worker or notification destination works. Do not enable payments just to silence alerts.
8. Obtain explicit approvals for deployment, migration, scheduling/settings, funding and financial execution. Begin only with a narrow reviewed cohort, clear operator ownership and kill switches. Measure the actual host invocation limit and provider latency: the worker processes refund/recovery/bank phases before orders, with per-request timeouts but no aggregate run deadline. Queue quotas alone do not bound wall-clock latency. Slow-provider and worst-case backlog tests must demonstrate orders are reached within the supported invocation/cadence before enabling the pilot; otherwise implement a reviewed execution-budget/phase design first.

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
