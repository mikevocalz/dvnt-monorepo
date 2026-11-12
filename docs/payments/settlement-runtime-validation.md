# Combined settlement runtime validation

This is a disabled engineering draft, not production approval. No production database, account setting, scheduler, credential, deployment or money movement is changed by these tests. `execute=false` prevents new provider transfers but still writes evidence, enrollment, leases and reconciliation state; it is not a read-only diagnostic. Replacement cleanup has its own cancellation gates, independent of transfer execution.

## Exact source composition

Artifact SHA-256: `671e5b02255c346fe2232e774677adf350db2880a42ee9aa7e3aa63cfe842966`.

Replacement installs before runtime cleanup and the outer fulfillment layer. The funding reserve wrapper remains authoritative. Canonical issuer migrations are installed before the generated artifact and never reinstalled afterward. The final chain preserves private renamed originals, receipt-required enrollment/reservation triggers, both `fulfillment_required` and `runtime_budget_required`, five-phase runtime scheduling, and terminal cleanup attention handling.

Independent combined checks under normal and permissive Supabase-style default privileges confirmed that all 50 private functions and 42 private tables deny client/service direct access, renamed public originals remain revoked, six execution flags are false, and policy/proof stores are empty. Real canonical issuance creates the immutable receipt before source enrollment. Missing fulfillment and unauthenticated raw funding claims are rejected.

## Local verification

- Final serial SQL/engine/endpoint matrix: **361/361 passed**, zero failures or skipped cases, in 460.4 seconds. There are **305 distinct names**; 56 repeated executions are imported engine cases. The inventory distinguishes 158 full/composed-artifact consumer cases from 147 intentionally scoped foundation/read-only helper cases. This includes six SQL readiness and eight promoter-budget cases.
- Shared backend/email suite: 1,221/1,221 passed, excluding the six SQL readiness cases run with the serial matrix.
- Replacement API/privacy: 26/26; actual cart endpoint/outcomes: 29/29.
- Mounted screens: 34 confirmation, 33 replacement, 12 replacement-entry and 42 promoter scenarios passed. Native host primitives are DOM stand-ins, not device/emulator testing.
- Actual native PostgreSQL/PostgREST relationship-query cases: 5/5; monitor/promoter endpoints: 44/44; repeat-ticket backend: 196/196.
- Scanner regressions: 4/4; targeted install-retry regressions: 4/4.
- Five changed dependency-free payment modules passed Deno checks: engine, hosted issuance, replacement cleanup, replacement coordinator and guest recovery. This is not a whole-monorepo typecheck.
- Edge imports (191 shipped functions), issuance invariants, identifier scan, migration reproducibility, Python compilation and diff checks passed. The issuance scanner retains seven pre-existing constraints that cannot be established from migration history alone.

Command totals overlap and must not be added as unique coverage.

## Real native concurrency

The final assembled artifact passed **69/69 PostgreSQL 17.6 groups** in fresh owned loopback clusters: base 20, external 9, replacement 6 and fulfillment 34. Seventy-eight intended blocking overlaps required positive `pg_blocking_pids` evidence before winner COMMIT. Three deliberate nonblocking boundaries separately verified TRUNCATE rejection, pre-cutover legacy visibility and stale runtime completion. Successful fixtures invoke the real canonical issuers; no immutable receipt is seeded. All owned clusters were stopped and removed.

Local execution used an incremental node-postgres transport, not a buffered query batch. Earlier buffered transport runs were discarded and are not overlap evidence. The checked-in canonical psql CI guards were not bypassed or faked. Final exact-head psql CI remains required even with these actual server results.

## Reproduce

Install isolated dependencies without changing the application lockfile:

`npm install --prefix /tmp/settlement-tests --ignore-scripts --no-audit --no-fund @electric-sql/pglite@0.3.14 typescript@5.9.3 esbuild@0.25.12 happy-dom@20.0.11 react@19.2.3 react-dom@19.2.3 zustand@5.0.14 @tanstack/react-query@5.90.16 @sentry/browser@10.69.0 zod@4.5.0`

Set `NODE_PATH=/tmp/settlement-tests/node_modules` and run serially:

- `node scripts/build-settlement-migration.mjs --check`
- `node --test --test-concurrency=1 scripts/test-settlement-*.cjs scripts/test-promoter-first-budget.cjs apps/mobile/supabase/functions/_shared/payout-readiness-sql.test.cjs`
- `node --test --test-concurrency=1 apps/mobile/supabase/functions/_shared/*.test.cjs apps/mobile/supabase/functions/_shared/email/*.test.mjs`
- `node --test --test-concurrency=1 apps/mobile/supabase/functions/get-cart-status/index.test.cjs packages/app/lib/tickets/checkout-outcome.test.ts packages/app/lib/api/checkout-replacement.test.cjs scripts/test-recovery-privacy.cjs`
- `node scripts/test-checkout-outcome-ui.cjs`
- `node scripts/test-checkout-replacement-ui.cjs`
- `node scripts/test-checkout-replacement-entry-ui.cjs`
- `node scripts/test-promoter-payout-ui.cjs`
- `npm run test:repeat-ticket-backend`
- `node --test scripts/verify-issuance-invariants.test.cjs scripts/ci-install-payout-reminder.test.cjs`
- `node scripts/verify-issuance-invariants.mjs`
- `node scripts/verify-edge-functions.mjs`
- `node scripts/verify-no-live-identifiers.mjs`

The Settlement concurrency workflow runs base, replacement and fulfillment native scripts against the full artifact. External settlement recording runs the remaining nine native groups. Each canonical command is `python3 scripts/<native-test-script>.py --disposable-ci-postgres`, restricted to disposable GitHub Actions PostgreSQL.

The Cart fulfillment snapshot workflow separately pins PostgreSQL 17.6, pg 8.16.3 and the official PostgREST 14.1 binary with SHA-256 verification. It runs `scripts/test-cart-status-postgrest.cjs` against its own temporary cluster; it accepts no existing database connection string.

## Exact-head CI boundary

The prior full-green checkpoint `97f31e7faba41c1d93084aabccfc97aed13858e5` passed all 41 workflows, including [native settlement](https://github.com/mikevocalz/dvnt-monorepo/actions/runs/43080752516), [external](https://github.com/mikevocalz/dvnt-monorepo/actions/runs/43080752425), [Edge Node/Deno](https://github.com/mikevocalz/dvnt-monorepo/actions/runs/43080752268), [web bundle](https://github.com/mikevocalz/dvnt-monorepo/actions/runs/43080752361) and [release typecheck](https://github.com/mikevocalz/dvnt-monorepo/actions/runs/43080752316). These results do not certify later changes.

The preceding UI head `13de23d7e20cbaef0d6543287b7b56ffc78ca311` completed 41/42 workflows successfully. The remaining [payout reminder run](https://github.com/mikevocalz/dvnt-monorepo/actions/runs/43087219438) failed before tests on both attempts with `ERR_PNPM_ENOENT` while renaming an esbuild temporary directory in the hoisted dependency tree. Three other runs with the same install-stage pattern passed their single retry. A pnpm hoisted-import race is the working hypothesis, not a proven root cause.

The reminder workflow now permits one same-workspace forced reinstall only for that exact error pattern, retaining the frozen lockfile and ignored lifecycle scripts. Every other install error and a second failure remains fatal. The mitigation must pass final CI; no assertion or typecheck is skipped. Inspect every workflow and job stage on the exact final draft head, using the complete paginated inventory rather than only the first page. Draft [#286](https://github.com/mikevocalz/dvnt-monorepo/pull/286) records subsequent exact-head results.

## Provider smoke and remaining release gates

A separately authorized smoke in an existing dedicated Stripe sandbox confirmed a labeled synthetic USD payment and full refund. The provider context reported sandbox isolation and live mode unavailable. A synthetic Accounts v2 recipient remained restricted pending onboarding. No transfer, reversal or payout ran; no credentials, settings or webhook configuration changed. This was not the repository checkout adapter, settlement worker or production-schema integration.

The current recipient adapter is v2-only. A legacy-only account returning `v1_account_instead_of_v2_account` is held before reservation/dispatch, with no automatic v1 fallback. Its no-dispatch regression is a safety result, not existing-v1 end-to-end support. The legacy compatibility follow-up remains separate.

Still required: final exact-head native/full CI; production schema/trigger/data review; approved migration history; repository adapter/provider end-to-end tests; complete new-recipient onboarding and compatibility; transfer/reversal/bank lifecycle; webhook/lost-response tests; real source-audit volume and holding limits; pre-cutover pending-liability review and drain; approved platform sweep configuration; frozen legacy ownership reconciliation; operator/alert routing; scheduler provisioning; actual host invocation limits and slow-provider cadence; and explicit live approvals.

The worker has admission budgets and durable phase rotation, not a hard process deadline or a guarantee for indivisible proofs exceeding the host budget. Confirmed promoter transfer is not bank deposit. External receipts are authenticated operator attestations, not machine proof from another payment service. Database reserves are not physical segregation. No local green test implies any production financial action is safe to execute.
