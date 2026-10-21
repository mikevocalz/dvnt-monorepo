# Free-ticket self-service correction

## Verified defect

Both ticket-detail screens displayed **Request Refund** for any active credential
more than 24 hours before its event. They did not check the actual purchase amount.
The confirmation body already distinguished free tickets, but the label, loading
state and mutation were still the monetary-refund path.

The legacy free branch in `ticket-refund` separately voided the ticket and
decremented inventory. It did not verify that its status update actually changed
one row before releasing a seat, nor synchronize the RSVP atomically. The event
page's separate `not_going` RSVP toggle is not a ticket-cancellation substitute.

## Behavior

- `get-my-tickets` projects a server-authorized action using the credential,
  original order/cart buyer, actual amount and payment, status and event policy.
- Known-zero admission credentials show **Cancel RSVP**; zero-price non-admission
  credentials show **Cancel Ticket**. Positive payments retain **Request Refund**.
- Null/invalid amounts and missing purchase context fail closed. Event list price
  or a generic paid/free flag never authorizes a refund.
- Used, transferred, pending-transfer and terminal credentials expose no action.
  Existing organizer policy and the conservative 24-hour UI cutoff are retained.
- Real zero-priced cart lines and zero-price tickets attached to positive-value
  orders remain unsupported and expose neither a fake refund nor unsafe cancel.
  Synthetic legacy RSVP group IDs with verified zero-value orders are supported.
- Free cancellation changes one credential. It does not refund or cancel sibling
  tickets, orders or paid add-ons. The RSVP becomes `not_going` only after the last
  valid credential for that owner/event is gone.
- `cancel_free_ticket` commits ticket voiding, inventory release, Wallet
  invalidation and RSVP synchronization together. Replays do not release again.
- A legacy comp issuer can hold event locks before tier locks. Cancellation uses
  `NOWAIT` on the event to return a retryable 503 and roll back rather than deadlock.
- Transfer initiation now claims an owned, active, unchecked ticket with a checked
  compare-and-set result, preventing stale transfer reads from reviving a void ticket.
- Both UI handlers prevent concurrent repeated submissions across A→B→A navigation
  and suppress late success/navigation after route/account changes or unmount.
- Order-detail screens also require a positive final paid total before offering
  an order-level support refund request. The `purchases` handler enforces the
  same guard, while positive paid add-on totals remain eligible.

## Verification

`npm run test:ticket-self-service` executes the real API/edge handlers, authoritative
projection and mounted production web/native screens with offline network fixtures.
Native host primitives are DOM stubs, not device testing.

`npm run test:ticket-cancellation-sql` requires a disposable local PostgreSQL server.
It applies the actual attendance-trigger migration and new cancellation migration,
then checks multiple concurrent connections, transfer/scan/issuer contention,
idempotent replay, authorization and injected transaction failures. It has no skip
fallback. `POSTGRES_SINGLE_USER=1` is a separately labelled sequential supplement,
not evidence of concurrency.

The draft's dedicated GitHub workflow runs both commands without project secrets.
The first published source tree passed all 12 real PostgreSQL concurrency/rollback
checks in CI, with zero skips. Recheck the latest PR head before release.
The broad existing ticket-release suite and release/issuance gates must remain green.
Local full-web and shared-package typechecks were killed by runtime resource limits;
focused helper typecheck, changed-file lint and executable regression tests ran.

## Release boundary

This is source-only. No live cancellation, refund, purchase, migration, deployment
or native release is authorized by preparing this draft.

After separate release approval: apply the cancellation migration first; verify
service-role-only execution; deploy the reviewed `ticket-refund`, `transfer-ticket`,
`get-my-tickets` and `purchases` dependency closures; then release web. Older servers omit the
action projection, so updated UI fails closed. Native changes require their own
release. Old clients cannot silently cancel free tickets through monetary refund.

The broader paid-refund transaction/idempotency design and unrelated legacy
inventory writers are not repaired by this patch.
