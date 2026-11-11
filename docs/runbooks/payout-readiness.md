# Payout readiness monitoring

This monitor observes why payouts cannot progress. It does not release funds,
assign release dates, retry settlement, backfill charge models, or enable a
scheduler. An alert is a request to investigate, never permission to transfer.

## Deployment boundary

This is a draft change. Apply the observation-only migration before deploying
`db-health` and its shared helper, under the normal approved release process.
It adds two service-role-only RPCs and one private alert-state row. Financial
source tables and `job_heartbeats` are never modified. It creates no cron jobs
and invokes no payment functions. No live changes have been made by this draft.

The existing `db-health?checkin=1` scheduled probe calls the readiness monitor.
Normal `db-health` uptime requests keep their database-only response. If the
snapshot or alert-claim RPC is unavailable, the scheduled response is HTTP 503
with `payoutMonitoringOk:false` and the existing check-in ends in error. Verify
that the existing db-health dead-man route and Sentry notification destination
are actually configured; a capture attempt is not delivery confirmation.

## Signals

The snapshot is available to operators via the read-only call:

```sql
SELECT public.get_payout_readiness();
```

It returns aggregate counts and execution timestamps, not account identifiers,
promoter names or amounts:

- `missingReleaseDates`: paid ended pending events without a release date. This
  means unprepared, not necessarily overdue. No policy date is invented.
- `overduePendingEvents`: pending paid ended events more than 90 minutes past
  their stored release date. `heldEvents` covers held paid events at the same
  threshold, or with no release date at least 7 days after the event ended.
- `unverifiedFundingEvents`: paid ended unsettled events containing a NULL or
  non-separate-charge model. NULL is unknown, never evidence that a transfer is
  safe. Destination-charge funds may already be in the organizer account.
- `invalidPayoutStates`: paid ended events with NULL or unrecognized settlement
  state. Intentionally disabled and released events are excluded from the event
  queue counts.
- `unpaidPromoters`: positive signed unpaid ledger balances, grouped by event
  and promoter, at least 7 days after event end and more than 90 minutes after any
  stored release date. Includes released events so stranded promoter shares do
  not disappear. Fully reversed and stamped paid balances are excluded.
- `activeSchedules`: active pg_cron commands that name the release edge URL or
  `cron_payouts_release` wrapper. NULL means catalog unavailable; zero means no
  matching pg_cron job. Neither proves whether an external scheduler exists,
  and a schedule row alone never proves successful execution.
- `heartbeat`: last run, success and status for `payouts-release`. Missing and
  never-OK rows alert when there is work to investigate. Once a successful run
  exists, a 90-minute gap alerts even if the queue appears empty. A latest error
  alerts independently.

The 7-day fallback is a conservative elapsed-time observation threshold, not a
new payout eligibility rule or a business-day calculator. Refund/dispute,
funding, account capability, ledger and transfer evidence still require review.
The monitor cannot prove Stripe settlement or bank payout delivery.

## Alert behavior

`payout.readiness` uses the existing Sentry `captureEdge` path with a stable
message containing only allowlisted issue codes. One aggregate alert attempt is
claimed per distinct issue set, then at most hourly while unchanged. A healthy
observation clears the clamp so a recurrence alerts immediately. Claims are
serialized in PostgreSQL. Because alert capture is best effort, operators must
verify notification delivery separately. Database errors never enter Sentry or
the public response as raw strings.

If alert-state access itself fails, the worker logs the fixed line
`[db-health] payout readiness monitoring unavailable` and marks the scheduled
health check unhealthy. The generic database uptime endpoint remains usable.

## Response and release gate

1. Read the snapshot, the latest payment-worker logs and heartbeat. Check actual
   scheduler inventory and invocation results, not comments documenting cadence.
2. Reconcile affected orders against Stripe payment intents, destination
   transfers, refunds/disputes, promoter ledger and existing payout records.
3. Resolve unknown funding and any ambiguous transfer outcome before considering
   retries. An `on_hold` event may be a durable uncertain-operation lock. Do not
   clear it simply because it is old.
4. Verify the settlement-safety changes independently. Test partial failures and
   recovery with synthetic accounts and a scoped plan before any production run.
5. Obtain explicit approval for live deployment/migration, activation, release
   date assignment, money movement or state recovery. Never enable an hourly
   payment job solely to silence missing-schedule or heartbeat alerts.

For later rollout verification: prove one scheduled readiness observation,
its read-only database footprint, a controlled alert and recovery rearm,
and the independent dead-man alert route. This does not require running payouts.

## Local verification

```sh
npm install --prefix /tmp/payout-tests --ignore-scripts --no-audit --no-fund @electric-sql/pglite@0.3.14 typescript@5.9.3
NODE_PATH=/tmp/payout-tests/node_modules node --test apps/mobile/supabase/functions/_shared/payout-readiness*.test.cjs apps/mobile/supabase/functions/db-health/payout-readiness.test.cjs
node scripts/verify-edge-functions.mjs
```

SQL tests execute the actual migration in PostgreSQL-in-WASM with a controllable
clock and synthetic tables. They verify private permissions, missing scheduling,
funding/state/queue classifications, signed promoter sums, suppression/recovery,
and unchanged financial rows. Handler tests exercise the actual db-health
source and check public response boundaries. Production schema and alert delivery
verification remain release-time checks, not claims made by these offline tests.
