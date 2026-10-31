# Organizer platform fee total (draft)

One organizer-dashboard card shows the current New York calendar month's DVNT application fees, less actual application-fee refunds. Stripe processing is excluded from this fee amount, **not subtracted again as an expense**. This is not profit or organizer payout. No per-event fee breakdown is added.

## Evidence and scope

- Current month follows `orders.paid_at`, America/New_York, through request time, across every owned event. Event date and capped transaction lists are not the source.
- Complete keyset reads; no ticket/add-on joins that multiply payment fees. Shared PaymentIntents are counted once only when the entire payment belongs to the same owner/month cohort.
- Each positive payment requires an actual scoped Stripe application-fee snapshot, including payments whose orders remain paid: standalone fee refunds need not change order status.
- Missing currency, inconsistent recorded amounts, unsupported rails, provider failures, changed ownership, or incomplete evidence never become a zero or partial total.
- True free transactions remain zero. No current fee policy is reapplied to historical orders.

## Proposed activation bundle (not applied)

1. Empty, RLS-protected, service-only snapshot migration.
2. `reconcile-orders` closure adding bounded processing of explicitly enrolled fee snapshots only.
3. `get-host-dashboard` closure enrolling only the authenticated owner's current-month cohort and reading complete snapshots.
4. Web source release. Native source is included but requires its own normal release; no OTA implied.

The dashboard's existing POST acquires a **new reporting-cache enrollment side effect**. Activation needs explicit approval for cache writes and bounded read-only Stripe reconciliation of the enrolled historical current-month cohort. It does not alter orders, accounting amounts, tickets, refunds, transfers, payouts or emails. No global payment scan, automatic historical backfill, credential change or cron change is included.

Retain the deployed reconcile-orders fee-calculator dependency byte-for-byte; repository/runtime drift in that pre-existing helper is unrelated and must not be deployed accidentally.

## Freshness and timing

Initial verification is asynchronous and displays pending until the full cohort is verified. A worker processes at most 100 payment snapshots in a bounded run; 1,000 initial payments require at least ten successful runs (approximately 2.5 hours at a 15-minute cadence, longer during failures). This is not instant verification. Published coherent evidence remains dated during a refresh; incomplete new cohorts do not produce a partial amount. The card labels the oldest verified timestamp and stops presenting evidence beyond its freshness limit.

## Verification

`pnpm test:platform-fees`, `pnpm test:platform-fees:sql`, ticket-release regression suite, mounted web/native account-switch and empty/pending/error cases. Tests use synthetic fixtures only; no customer financial identifiers or real totals are embedded. Actual browser rendering was blocked by the environment's socket permission; mounted actual-component tests are not screenshot verification.
