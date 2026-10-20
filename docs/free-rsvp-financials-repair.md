# Free RSVP financials repair

## Defect and scope

The aggregate function counted every kept ticket as a $1 organizer-fee unit,
including free RSVP/comp issuance whose order and fees were all zero. This made
`event_financials.dvnt_fee_cents` incorrect. Event analytics displays that value;
`payouts-release` also reads its net, so mixed free/paid events were affected.

The migration counts a kept ticket/add-on only when its price is positive, or
its linked positive-total order records fees. The latter preserves historical
mixed paid-cart pricing, which charges every cart unit including zero-price
lines. Checkout policy, source orders/tickets, Stripe charges, refunds, transfers
and payout status are not changed by this migration. Percentage rounding,
refund calculations and the separate Stripe processor-fee ledger are unchanged.

## Verification

`node scripts/test-free-rsvp-financials.cjs --sql` emits a self-contained fixture
with the actual historical and new migrations, ready for an empty disposable
PostgreSQL database with `psql -X -v ON_ERROR_STOP=1`. CI runs this in the
`event-financials-addons` job. Never run the fixture against production.

For local environments without a native Postgres server, the same SQL can run
using an externally installed `@electric-sql/pglite` and `--pglite` (resolved
through `NODE_PATH` when installed in a disposable folder). PGlite is not an
application dependency. The `--baseline` option omits only the new migration;
it must fail on the two-free-RSVP cached-summary assertion.

Coverage includes existing-cache repair, free/comp/unknown-price rows, paid and
free tickets on the same event, existing paid-cart zero-price units, free and
paid add-ons, partial/full refunds, separate processor fees, fee-field updates,
ticket moves/deletes, consolidated ticket/add-on destinations, restricted RPC grants and migration reapplication. The
fixture verifies that applying the migration leaves source orders/tickets intact.

## Production repair plan (requires separate approval)

No production migration or cached-row update was executed while preparing this
change. Merging/publishing this draft alone is not evidence of a live repair.

1. Immediately before an approved application, read both current function bodies and
   the orders trigger definition, relevant source rows, and the affected cached financials.
   Retain a timestamped snapshot for verification/rollback. Recheck that payout
   processing is not using those events concurrently; do not initiate any payout
   or change its settings as part of this repair.
2. Review the current delta. At the 2026-10-20 22:46 UTC read-only snapshot, 23
   event summaries contained 573 fee-free kept tickets. The aggregate flat-fee
   reduction was $573; six mixed-sales events' cached net increased by $515.
   All affected event payout statuses were `pending`. Free-only event net stays
   zero because it was already clamped. These are cached calculation deltas,
   not card charges, refunds, or funds moved.
3. Apply only `20261020224444_free_rsvp_event_financials.sql` through the approved
   migration mechanism. Its function/trigger replacement and targeted summary
   refresh are in one transaction. It updates no source payment ledger rows.
4. Re-read the affected summaries and source orders/tickets. Verify free-only
   events have zero fees, mixed-event net changes match the current source
   rows, and gross/refunds/Stripe fees plus all source payment rows are unchanged.
   Read the host analytics response after the backend change. There is no UI
   deployment required for this backend fix.

### Snapshot delta for mixed-sales events

The six events' fee reduction/net increase, in cents, was:

- 90: 10,600
- 85: 11,100
- 83: 6,200
- 82: 5,200
- 80: 5,800 (preserves two zero-price units with real recorded paid-cart fees)
- 79: 12,600

The reported two-RSVP event, 106, changes cached platform fees from 200 to 0
cents, with gross and net remaining zero. Both source orders are USD, have zero
amounts/fees, and have no Checkout Session or PaymentIntent identifiers.

## Rollback

If the migration transaction fails, Postgres rolls back both the definition
changes and cached repair. Verify that state rather than retrying blindly.

After a committed application, rollback requires its own approval. Restore the
pre-application `recompute_event_financials(integer)` and
`orders_financials_refresh()` function definitions, and the
`orders_financials_refresh` trigger definition from the captured snapshot in a
single transaction, preserving the existing grants. The checked-in previous
function is in `20261009020000_event_financials_addon_revenue.sql`; the previous
orders trigger is in `20261006223500_stripe_processing_fee_ledger.sql`.
Do not blindly replay either whole historical migration, since they contain
other DDL and broad recomputations.

Recompute only the affected events against their current source rows under the
restored definition. Do not overwrite newer source activity with stale cached
rows, and never alter orders, Stripe charges or transfers during rollback.
Restoring the old definition reintroduces this known false-fee bug, so explicitly
review the effect on analytics and pending payout calculations before choosing
rollback over a forward fix.
