# One integrated payout draft

## Base and preservation

Target `master`, verified at `7298d4bd0966793d31a672734629e6e950f29e15` (the #283 non-Stripe release merge). Its authoritative Git tree is `a153580fb21436a3abd5ec408177ee541158eeff`, identical to the local reviewed `release/non-stripe-20261111` snapshot at `4a3c62f96449f000d57047e82d103049d9104043`.

The complete payout stack was replayed onto that exact tree, preserving every unrelated file from #283. Four paths overlapped:

- `apps/mobile/supabase/config.toml`: retain both the new post-media-lease authorization section and payout-worker/recording sections. No deployment occurs.
- `apps/mobile/supabase/functions/event-cancel/index.ts`: retain current event authorization and add refund debit dispatch around the existing provider call.
- `packages/app/features/events/analytics.web.tsx` and `packages/app/features/routes/screens/(protected)/events/[id]/analytics.tsx`: retain current event-manager access handling and add the actor-scoped settlement display.

Recheck the remote base immediately before publication. If master advances in these paths, reconcile it again and rerun affected tests. Never replace current master files wholesale with stale checkpoint copies.

## Draft scope and dependencies

Publish one complete integrated **draft** against current master, including the original charge-model foundation, paused runtime checkpoint, promoter-first ordering, external receipt recording, runtime/recovery/UI/watchdog work and tested source-accounted funding layer. Existing #281, #284 and #285 remain untouched as source/review slices; they are not independently enabled and are not prerequisites that must be merged in an undocumented order.

The integrated runtime's generated SQL is [an offline test artifact](drafts/settlement-runtime-v1.generated.sql), not a pending Supabase migration. It assumes a fresh settlement namespace. The existing external receipt guard migration owns shared SQL objects and must remain unchanged; the test artifact deliberately refuses to overwrite it. The [adoption candidate](drafts/settlement-adoption.generated.sql) installs the runtime over the standalone receipt guard without changing its receipt, quarantine, operator or session records. It rejects partial runtime state and requires existing recording and reporting controls to be off; all new execution remains disabled. The original claim and session endpoints remain in place, while the runtime and legacy transfer paths cannot both own one event. Review and validate this candidate on a disposable copy of the deployed schema before deciding whether to promote it into migration discovery. Historical date backfill, worker deployment, and payment activation are separate operations. Assemble the offline artifact only with `node scripts/build-settlement-migration.mjs`.

Publication means code is available for review, not approved for merge, deployment, live schema changes, account settings, scheduler activation or financial execution. Verify the exact remote commit/tree and required CI after publication. Missing sandbox/provider validation and all live approvals remain blockers even with green offline/native tests.
