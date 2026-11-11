# Offline integrated runtime validation

This record concerns synthetic offline engineering only. `execute=false` prevents new provider transfers but still writes source/enrollment/reconciliation state; it is not a read-only production dry run. No production database, account setting, scheduler, credential or money movement is changed by these tests. The full payout stack is based on the exact current-master tree described in settlement-publication-plan.md, preserving the newer non-payment release.

## Reproduce

Install isolated test dependencies (do not modify the app lockfile):

`npm install --prefix /tmp/settlement-tests --ignore-scripts --no-audit --no-fund @electric-sql/pglite@0.3.14 typescript@5.9.3 esbuild@0.25.12 happy-dom@20.0.11 react@19.2.3 react-dom@19.2.3 zustand@5.0.14 @tanstack/react-query@5.90.16`

Set `NODE_PATH=/tmp/settlement-tests/node_modules`, then run:

- `node scripts/build-settlement-migration.mjs --check`
- `node --test --test-concurrency=1 scripts/test-settlement-*.cjs scripts/test-promoter-first-budget.cjs`
- `node --test --test-concurrency=1 apps/mobile/supabase/functions/_shared/payout-readiness*.test.cjs apps/mobile/supabase/functions/_shared/settlement-readiness.test.cjs apps/mobile/supabase/functions/db-health/payout-readiness.test.cjs apps/mobile/supabase/functions/promoter-self/index.test.cjs`
- `node scripts/test-promoter-payout-ui.cjs`
- `node --test --test-concurrency=1 apps/mobile/supabase/functions/_shared/*.test.cjs`
- `npm run test:cohost-editing`
- `node --test scripts/verify-issuance-invariants.test.cjs`
- `node scripts/verify-issuance-invariants.mjs`
- `node scripts/verify-edge-functions.mjs`
- `node scripts/verify-no-live-identifiers.mjs`
- `python3 -m py_compile scripts/test-settlement-concurrency.py scripts/test-external-settlement-concurrency.py`

The seven dependency-free shared payment modules also pass `deno check --no-config --node-modules-dir=none --no-lock`: settlement-engine, settlement-funding, settlement-recovery, settlement-readiness, payout-readiness, settlement-checkout and legacy-ownership-summary under apps/mobile/supabase/functions/_shared.

Use bounded serial Node concurrency. The endpoint/funding/webhook-link harnesses import the 13-case engine suite; their reported totals repeat those names. Do not add those repetitions or separate command totals as unique coverage.

## Recorded local results on the integrated checkpoint

- Core SQL/engine/endpoint: 216 reported assertions passed, 164 distinct named cases. Full generated artifact included funding last. Includes reviewed legacy ownership, inherited-ACL hardening, overdue/unknown-checkout alerts, fair ordered queues and the two-constraint risk buffer. One stale nonpaid fixture was corrected to reject contradictory positive-money evidence before testing exact zero-money proof.
- Full shared backend suite after overdue alerts: 1,180 assertions passed before the final queue change. The final changed readiness module passed all 11 cases; exact-head CI reruns the complete shared suite.
- Rebased current event-authorization suite: 151 Node assertions plus 98 mounted organizer/staff/promoter/analytics permission scenarios passed.
- Final reviewed-recipient endpoint/monitor suite: 49 assertions passed; actual web/native promoter screens: 42 mounted scenarios passed.
- Final assembled funding/bridge/default-off/catalog/default-grant focused run: 9 assertions passed.
- Static edge imports: 189 shipped functions, no unpinned/floating imports. New-live-identifier scan passed; existing baseline occurrences are not newly added data.
- Seven shared Deno module typechecks passed. Full endpoint Deno check could not retrieve the pinned Sentry dependency in the local executor; exact-head CI must provide that evidence.

These local checks are synthetic code evidence, not a release certificate. Exact-head native and full CI results must be verified on the published draft. See the PR for the remote tree and workflow links. Canceled-checkout replacement remains a separately documented follow-up.

## Native concurrency and CI

The Settlement concurrency workflow runs the **full assembled artifact** in disposable native PostgreSQL databases. External settlement recording runs its additional receipt/legacy arbitration and bank-lock races against that same artifact. Both runners refuse normal local/remote/production targets; compiling or refusal-checking them is not executing their races.

Initial validation had no usable native PostgreSQL transport. Later validation found packaged PostgreSQL binaries and used isolated local clusters, as recorded below. Required exact-head canonical psql CI results and links still belong in the integrated draft PR. Green source-slice PRs do not replace the final assembled tests. Review every applicable workflow/job stage on the final remote commit, including shared Node/Deno and build checks, rather than assuming the first page of workflow listings is complete.

## Not covered by local green tests

Production schema/trigger/data compatibility; actual provider API and transfer/refund/bank lifecycle; new-account onboarding; source audit bounds under real volume; pre-cutover pending liabilities; applicable country/product holding limits; platform sweep configuration; operator permissions and manual/provider-side debits; frozen legacy identity reconciliation; independent alert delivery; scheduler provisioning; actual host invocation duration/cadence and slow-provider phase-progress tests; and all live approvals remain separate. Refund/recovery/bank phases precede the order queue and have no aggregate run deadline, so queue fairness alone is not a payout latency guarantee.

No full monorepo build/typecheck, sandbox transfer, live payment, production migration or deployment was performed locally. Provider sandbox validation is blocked: connected links currently expose live context only, so separately authorized dedicated sandbox access is required. No live financial probe or mode change is permitted to substitute. Verified existing-account v1/v2 recipient reads do not prove the full new-account and bank-payout lifecycle. Reviewed external receipt records are authenticated operator attestations, not machine proof from an outside payment provider. Confirmed promoter transfer is not bank deposit. Database reserves are not physical segregation.

## Published checkpoint CI and scoped follow-up

Draft [#286](https://github.com/mikevocalz/dvnt-monorepo/pull/286), initial head `447b3d859a8b59a5cd26ef0a0e4dcfac01dcaab9`, exactly matches tested local tree `2dc271650fe47a09c03433b792af3124fef40711`. On that head, [Settlement concurrency](https://github.com/mikevocalz/dvnt-monorepo/actions/runs/43079377988) passed all 16 overlapping native PostgreSQL cases plus offline integration. [External settlement recording](https://github.com/mikevocalz/dvnt-monorepo/actions/runs/43079377992) passed 50 focused assertions and 9 native races. These results certify only those checkpoint tests, not later changes or release readiness.

Initial broader CI found a static scanner incorrectly treating a private schema name as a public table and demanding direct service access. The scanner now parses qualified names, with four regressions; financial ACLs remain unchanged. The shared Node workflow also lacked its new SQL suite's pinned PGlite dependency; the isolated install now includes it and runs serially. The final local top-level shared Node rerun passed 1,181/1,181 assertions, with another 45/45 in the nested email suite. An admission workflow hit a pnpm temporary-file rename installation failure. Later exact-head CI must verify all jobs again.

The independently reviewed duplicate-attempt follow-up closes fresh-key terminal-status, cross-rail, overlapping cart-selection and equivalent UUID-spelling bypasses. Guard/runtime/assembled-artifact tests passed 27/27 locally. It does not enable canceled-attempt replacement.

**Unsafe for rollout:** source verification can currently enroll/pay an order whose actual ticket issuance failed or is absent. Authoritative atomic fulfillment proof is a required follow-up, including SQL enforcement and negative/native tests. Full replacement-attempt recovery and bounded whole-worker invocation progress also remain separate reviewed work. Keep all execution gates off; green accounting and locking tests do not prove ticket entitlement or complete checkout fulfillment.

## Reviewed event cutover integration

The prior published head `97f31e7faba41c1d93084aabccfc97aed13858e5` completed all 41 workflows successfully, including [17 native settlement cases and offline integration](https://github.com/mikevocalz/dvnt-monorepo/actions/runs/43080752516), [external native and receipt tests](https://github.com/mikevocalz/dvnt-monorepo/actions/runs/43080752425), [all Edge jobs with 1,226 Node and 151 Deno tests](https://github.com/mikevocalz/dvnt-monorepo/actions/runs/43080752268), [web bundle build](https://github.com/mikevocalz/dvnt-monorepo/actions/runs/43080752361), and [release typecheck](https://github.com/mikevocalz/dvnt-monorepo/actions/runs/43080752316). That complete green checkpoint is not evidence for later changes or production rollout.

This follow-up integrates the independently reviewed permanent per-event cutover fence and deny-only guards for unsupported door web/Terminal, embedded quote/checkout/resume and ticket-upgrade payments. Never-cutover behavior remains available. Missing schema or route evidence fails closed, and cutover events never fall back to legacy after flags or policies are removed. Install the empty-policy migration before these adapters and drain previously admitted legacy requests before any actual cohort change. This is not an atomic live transition controller.

Final local core run: 241/241 reported assertions, 188 distinct names. Focused actual-handler run: 298/298 assertions, 296 distinct names; these overlap core/imported fixtures and must not be added as unique coverage. The final full shared Node run passed 1,226/1,226, and the regenerated artifact/default-grant suite passed 9/9. A standalone sale fixture was updated for the new required never-cutover routing read; its 210/210 cases passed without changing handler behavior. Both dependency-free routing adapters passed Deno typecheck. Migration assembly, private/default-off catalog checks, edge import scan, issuance scan and identifier scan passed. The native script now includes 18 cases, including the deliberately demonstrated pre-cutover request-drain boundary; final-head native execution remains a separate CI result.

Reproduce additional handlers with `node --test --test-concurrency=1 apps/mobile/supabase/functions/_shared/checkout-charge-model.test.cjs apps/mobile/supabase/functions/_shared/checkout-replay.test.cjs apps/mobile/supabase/functions/_shared/payment-safety.test.cjs apps/mobile/supabase/functions/ticket-embed/index.test.cjs apps/mobile/supabase/functions/guest-checkout/discounts.test.cjs`. Core glob includes the cutover and unsupported-rail tests. No fulfillment, replacement, UI outcome or runtime-budget follow-up is included by this cutover integration alone.


## Reviewed checkout confirmation and privacy

This narrow checkpoint includes only the independently reviewed paying-state and cart-status UI/privacy pair. It does not include the replacement APIs or the pending authoritative financial fulfillment gate. The endpoint reads one actor-scoped relationship snapshot, verifies expected versus observed units and current credential ownership, and distinguishes usable, partial, historical and unverified results. The web/native screens do not celebrate pending payment, refunded/void/consumed units or unverified completeness. These display checks cannot authorize settlement transfers.

Local checks passed: 14 actual endpoint cases plus 15 outcome cases, 34 mounted web/native scenarios, 5 exact-query native PostgreSQL 17.6/PostgREST 14.1 cases, 196 repeat-ticket backend cases and 59 ticket-library/outcome cases. Counts overlap and are not additive unique coverage. The native query test creates its own private temporary cluster, uses loopback only and accepts no existing database connection string. Its CI job pins the official PostgREST release and verifies the release SHA-256. Reproduce with the checked-in scripts/test-cart-status-postgrest.cjs, SYNTHETIC_POSTGREST_BIN pointing to that installed binary, and isolated typescript/pg/@embedded-postgres dependencies.

Two prior-head CI test failures are repaired without weakening production guards: the upgrade category fixture now loads the real route helper, and the cutover concurrency fixture terminates its INSERT and uses an explicit observed flag before commit rather than assuming a one-second sleep always overlaps the observer. Canonical exact-head native CI remains required for this checkpoint.


After those fixture repairs, all 18 settlement scenario functions passed locally against a newly created PostgreSQL 17.6 cluster using a streaming node-postgres transport. Lock acquisition and its marker were sent as a completed query before the delayed commit on the same connection; the cutover case additionally waits for an explicit observer flag. The initial batched local transport run is not accepted as overlap evidence. This local transport did not change or bypass the checked-in canonical CI runner's guard, and final-head psql CI is still required. The cluster was stopped and removed after the run.
