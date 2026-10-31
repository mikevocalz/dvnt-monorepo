# Organizer platform fee total (draft)

One organizer-dashboard card shows the current New York calendar month's DVNT application fees, less actual application-fee refunds. Stripe processing is excluded from this fee amount, **not subtracted again as an expense**. This is not profit or organizer payout. No per-event fee breakdown is added.

## Evidence and scope

- Current month follows `orders.paid_at`, America/New_York, through request time, across every owned event. Event date and capped transaction lists are not the source.
- Complete keyset reads; no ticket/add-on joins that multiply payment fees. Shared PaymentIntents are counted once only when the entire payment belongs to the same owner/month cohort.
- Each positive payment requires an actual scoped Stripe application-fee snapshot, including payments whose orders remain paid: standalone fee refunds need not change order status.
- Missing currency, inconsistent recorded amounts, unsupported rails, provider failures, changed ownership, or incomplete evidence never become a zero or partial total.
- True free transactions remain zero. No current fee policy is reapplied to historical orders.

## Revised reporting-only activation bundle

1. **Already applied:** empty RLS-protected, service-only cache migration `20261031131615_scoped_platform_fee_report.sql`. Do not reapply it. No historical rows were enrolled by the migration.
2. New `refresh-platform-fees` reporting-only function. Its runtime closure contains only its handler and the fee-reader helper. It does not import, invoke or replace `reconcile-orders` or any ticket, payment, cancellation, payout or email recovery code.
3. `get-host-dashboard` update to enroll only the authenticated owner's current-month cohort and read verified reporting results.
4. Incremental reporting-only migration `20261031153724_platform_fee_fair_claims.sql`: adds the `platform_fee_reports.last_claimed_at` fairness cursor and replaces only `claim_platform_fee_snapshots(integer)`. It rotates eligible owner/month cohorts with row locks and `SKIP LOCKED`, preserving source validation, two-minute leases, bounded attempts, service-only access, enrollment, publication, and 20-hour/24-hour freshness rules. It does not recreate the existing cache or enroll source records.
5. A separately approved dispatcher/schedule migration for only the new reporting worker. User-approved cadence: `7 */4 * * *` UTC (00:07, 04:07, 08:07, 12:07, 16:07 and 20:07), leaving the existing recovery schedule untouched. The previously proposed 15-minute reporting cadence was denied and must not be activated. It references the existing `CRON_SECRET` Vault entry; no secret creation or rotation is included.
6. Web source release. Native source is included but requires its own normal release; no OTA implied.

The dashboard's existing POST acquires a **reporting-cache enrollment side effect**. Activation needs explicit approval for cache writes, the new reporting-only schedule, and bounded read-only Stripe verification of the enrolled current-month cohort. No payment, refund, ticket, payout, email or accounting-repair operations are added. There is no global history scan or manual full synchronization.

The reporting worker's database adapter exposes only `claim_platform_fee_snapshots` and `complete_platform_fee_snapshot`; even an attempted call to enrollment or a payment RPC is rejected. The provider helper uses GET only, rejects redirects, and permits only fixed Stripe PaymentIntent/charge/application-fee resources. Database scope checks revalidate ownership before reads and publication. Existing server credentials have broader underlying permissions; these code-level boundaries are not a claim that the credentials themselves are read-only.

No existing recovery function or schedule is changed or redeployed by this revised design.

## Freshness and timing

Initial verification is asynchronous and displays pending until the full cohort is verified. The user approved larger, safely rate-limited batches after the four-hour cadence exposed a conflict with the original 100/run budget. The larger-batch envelope is at most 400 payment snapshots per invocation, with a 110-second runtime ceiling, at most 12 provider GET starts per sliding second per invocation (including fallback resources), and four concurrent reads; slow/provider-limited runs may process fewer. The dispatcher allows 120 seconds. The worker stops claiming by 98 seconds, stops provider work by 105 seconds, and reserves time for completion within its 110-second budget. Database awaits are bounded to three seconds and propagate an abort signal; an aborted or lost response may still have committed server-side, so the worker stops new claims and relies on lease-token verification/retry rather than counting an uncertain result as verified. Existing authentication, read-only provider operations, and the 24-hour evidence freshness policy remain unchanged.

At the maximum successful capacity, 1,000 initial payments require three scheduled runs (up to approximately 12 hours after enrollment), and 1,207 require four (up to approximately 16 hours). These are synthetic healthy expanded-response capacity scenarios, not delivery guarantees. Three-resource fallback reads share the same rate budget and can stop below 400 items when the deadline is reached; provider failures, backoff, slow requests, and contention among enrolled organizers can take longer. The oldest successful snapshot is eight or twelve hours old in those respective scenarios. Pending enrollment freezes the target and retains completed chunks; incomplete cohorts never produce a partial amount. Published coherent evidence remains dated during a refresh. The card labels the oldest verified timestamp and hides amounts beyond the unchanged 24-hour freshness limit.

**Why the old budget was insufficient:** 1,000 distinct initial payments at 100/run every four hours require ten runs (approximately 40 hours). The oldest snapshot is about 36 hours old when the last chunk completes, so both SQL and the dashboard loader correctly mark that complete report unavailable. Re-enrolling does not solve the capacity mismatch: the next generation requeues snapshots older than 20 hours while retaining fresh chunks. Synthetic-clock regression coverage preserves this 56-hour failure case, and separately checks that the approved larger batches complete 1,000 and 1,207-payment cohorts within the existing freshness window. The cadence change never authorizes stale totals, unbounded batches, accounting repairs, or changes to recovery workers.

## Verification

`pnpm test:platform-fees`, `pnpm test:platform-fees:sql`, `node --test apps/mobile/supabase/functions/_shared/platform-fee-four-hour-sql.cjs apps/mobile/supabase/functions/_shared/reporting-only-fee-schedule-sql.cjs`, ticket-release regression suite, mounted web/native account-switch and empty/pending/error cases. Tests use synthetic fixtures only; no customer financial identifiers or real totals are embedded. Actual browser rendering was blocked by the environment's socket permission; mounted actual-component tests are not screenshot verification.
