# Settlement expansion: paused local WIP

Paused 2026-11-11 at the user's direction. This checkpoint is not approved for deployment, migration, scheduling, or provider writes. PR #281 contains the previously published foundation; the expanded implementation at this checkpoint has not been published or validated as a complete release.

## Preserved implementation

Four checkout rails and immutable replay; durable recipient/economic snapshots; source-charge verification; funding epochs and allocation reservations; transfer executor and uncertain-outcome reconciliation; refund/dispute interlocks; reversal recovery; verified connected-account automatic bank-payout membership; fair queues; private actor read model and UI integration; default-off worker and observability drafts. Integrates portions of #275, #276, #278 and #280. All financial execution remains disabled by default. No production schema, settings, provider account or funds were changed.

## Must finish before publication or rollout

- The generated migration `20261111040111_settlement_runtime_v1.sql` is EMPTY. Assemble and validate the ledger, runtime, recovery and observability SQL together before treating this as a deployable artifact.
- Re-run all tests against the final integrated tree. Earlier green logs do not certify the current tree. Latest recorded runtime test had a date-format assertion failure, reporting had an import-harness failure, and sweep tests ran before the final webhook integration. Fixes/integration need verification.
- Integrate #277 hardened missing/never-successful worker watchdog. Merely returning settlement_health from the manual endpoint does not alert on an enabled worker that never starts. Disabled-by-design must not alert; enabled with no schedule/due work must.
- Resolve release policy explicitly: current seconds-based delay is NULL by default and cannot represent existing end-plus-five-business-days policy. Current preparation requires end_date, but many events use canonical start_date-plus-six-hours fallback. Restrict an approved cohort or implement the approved policy and test null end, timezone and rescheduling. Never silently substitute a policy.
- Finish #278 onboarding/status UI integration and mounted tests. A verified empty new-ledger summary must not hide legacy pending earnings; mixed legacy/new earnings require truthful separation. Gross transfer amounts and verified net bank contribution are different.
- Update the original foundation rollout document: it still describes earlier missing adapters. Clearly distinguish implemented code from unverified provider/runtime integration.
- Native PostgreSQL concurrency runner has only been compiled/refusal-checked, not executed. Its seven cross-process cases require isolated CI after coherent draft publication. PGlite tests alone do not prove cross-process locking.
- Validate actual migration/schema compatibility, v1/v2 account contracts and capability mappings, all four flag-off checkout rails, full refund transports and entrypoint authorization/error sanitization.
- No real Stripe sandbox or live financial execution was performed. Sandbox integration, release-policy approval, funding verification, production migration/deployment review, schedule provisioning and alert routing remain explicit rollout gates.

## Deliberate manual-review boundaries

Legacy destination-funded charges must never be backfilled or funded twice. Won disputes retain holds until typed/provenance-checked reviewed release; unknown partial-cart eligible refund allocations remain quarantined. Source transfer auditing is bounded at 100 pages and source verification expires; old/high-volume cases can require manual reconciliation and alerting rather than weakening proof. Manual or recovery event holds, cancelled/disabled events, source/account/funding restrictions are never bypassed by the owner dispute-only exception. Transfer success is not bank payment; aggregate/manual payout without verified attribution stays unknown.

## Earlier isolated verification (not final-tree certification)

Recorded green local logs: checkout 233 tests, ledger 10, engine 8, endpoint suite 11 (includes engine tests). Recovery worker previously reported recovery 16 plus refund endpoint 74. Engine, recovery and linker TypeScript checks and the pinned edge import verifier passed at earlier checkpoints. Counts overlap and must not be summed. Final linker/UI/reporting/runtime/sweep and full integrated reruns remain outstanding.
