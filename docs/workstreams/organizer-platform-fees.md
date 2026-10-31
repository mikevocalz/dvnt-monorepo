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
4. A separately approved dispatcher/schedule migration for only the new reporting worker. Proposed cadence: minutes 7, 22, 37 and 52 of every hour, leaving the existing recovery schedule untouched. It references the existing `CRON_SECRET` Vault entry; no secret creation or rotation is included.
5. Web source release. Native source is included but requires its own normal release; no OTA implied.

The dashboard's existing POST acquires a **reporting-cache enrollment side effect**. Activation needs explicit approval for cache writes, the new reporting-only schedule, and bounded read-only Stripe verification of the enrolled current-month cohort. No payment, refund, ticket, payout, email or accounting-repair operations are added. There is no global history scan or manual full synchronization.

The reporting worker's database adapter exposes only `claim_platform_fee_snapshots` and `complete_platform_fee_snapshot`; even an attempted call to enrollment or a payment RPC is rejected. The provider helper uses GET only, rejects redirects, and permits only fixed Stripe PaymentIntent/charge/application-fee resources. Database scope checks revalidate ownership before reads and publication. Existing server credentials have broader underlying permissions; these code-level boundaries are not a claim that the credentials themselves are read-only.

No existing recovery function or schedule is changed or redeployed by this revised design.

## Freshness and timing

Initial verification is asynchronous and displays pending until the full cohort is verified. A worker processes at most 100 payment snapshots in a bounded run; 1,000 initial payments require at least ten successful runs (approximately 2.5 hours at a 15-minute cadence, longer during failures). This is not instant verification. Published coherent evidence remains dated during a refresh; incomplete new cohorts do not produce a partial amount. The card labels the oldest verified timestamp and stops presenting evidence beyond its freshness limit.

## Verification

`pnpm test:platform-fees`, `pnpm test:platform-fees:sql`, ticket-release regression suite, mounted web/native account-switch and empty/pending/error cases. Tests use synthetic fixtures only; no customer financial identifiers or real totals are embedded. Actual browser rendering was blocked by the environment's socket permission; mounted actual-component tests are not screenshot verification.
