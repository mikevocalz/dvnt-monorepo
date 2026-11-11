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

The local executor has no native PostgreSQL binaries. Required exact-head native results and links belong in the integrated draft PR. Green source-slice PRs do not replace the final assembled tests. Review every applicable workflow/job stage on the final remote commit, including shared Node/Deno and build checks, rather than assuming the first page of workflow listings is complete.

## Not covered by local green tests

Production schema/trigger/data compatibility; actual provider API and transfer/refund/bank lifecycle; new-account onboarding; source audit bounds under real volume; pre-cutover pending liabilities; applicable country/product holding limits; platform sweep configuration; operator permissions and manual/provider-side debits; frozen legacy identity reconciliation; independent alert delivery; scheduler provisioning; actual host invocation duration/cadence and slow-provider phase-progress tests; and all live approvals remain separate. Refund/recovery/bank phases precede the order queue and have no aggregate run deadline, so queue fairness alone is not a payout latency guarantee.

No full monorepo build/typecheck, sandbox transfer, live payment, production migration or deployment was performed locally. Provider sandbox validation is blocked: connected links currently expose live context only, so separately authorized dedicated sandbox access is required. No live financial probe or mode change is permitted to substitute. Verified existing-account v1/v2 recipient reads do not prove the full new-account and bank-payout lifecycle. Reviewed external receipt records are authenticated operator attestations, not machine proof from an outside payment provider. Confirmed promoter transfer is not bank deposit. Database reserves are not physical segregation.
