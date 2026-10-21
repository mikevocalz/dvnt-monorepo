# Atomic free guest issuance

## Defect and scope

Free guest checkout used separate API writes for its order, tickets, hold
conversion and sold counter. Converting the hold before updating the counter
temporarily reopened an already-issued seat. Concurrent requests also wrote
the same previously read `quantity_sold + quantity`, losing increments. The
shared atomic hold RPC trusts that counter, so the drift could admit later
buyers, not merely show a stale availability number. Failed issuance attempted
to set a hold to `released`, which the deployed `active/converted/expired`
constraint rejects.

`guest_free_checkout_atomic` now performs those writes in one transaction while
holding the same tier lock used by the legacy paid hold RPC. Every SQL failure
rolls back the order, tickets, hold and counter together. Idempotent keys are
serialized before the tier lock; replay also validates buyer, event, tier and
quantity. The email cap and base-price snapshot are rechecked under the lock.
The service-role-only function accepts the edge's server-validated zero-total
order, including full-discount and promoter snapshots. Email, profiles, promo
usage and attribution remain after commit; simultaneous replay does not repeat
those side effects.

The guest capacity check uses the larger of recorded sold inventory and actual
kept ticket rows, plus both active hold tables. This prevents an older paid
writer's stale counter from admitting another free guest. Refunded/void tickets
do not occupy that floor; scanned, transfer-pending and unknown/null statuses do.
An issued ticket with an unconverted paid hold can temporarily be counted twice,
which safely rejects checkout until that paid hold is converted or expires.

This is a guest-free-issuance fix, not a claim that all ticketing races are fixed.
Other paid/refund rails still contain absolute sold-counter writes; their own
admission/fulfillment behavior is unchanged. This migration does not reconcile
historical counters or modify shared paid/cart RPC definitions.

## Release ordering

1. Review and apply `20261021142135_guest_free_checkout_atomic.sql` through the
   normal approved migration process. Applying it only creates the restricted
   function and refreshes the schema cache; it does not rewrite existing data.
2. Deploy the matching `guest-checkout` edge function. The narrow free-RSVP
   event eligibility fix is preserved.
3. Verify approved fixture checkout behavior in the release environment.

Do not deploy the edge before the migration: a missing RPC deliberately fails
closed with no fallback to the unsafe split writes. Rolling back the edge
reintroduces the original race; leaving the new unused RPC installed is safe.
No live migration, deployment, checkout, ticket creation or email is part of
the source PR's validation.

## Regression checks

- `node --test apps/mobile/supabase/functions/guest-checkout/*.test.cjs`
- `node scripts/verify-guest-free-issuance.mjs`

The SQL harness starts a disposable socket-only PostgreSQL cluster and runs the
real migration with multiple connections. Lock-state barriers prove conflicting
requests actually block. Coverage includes last-seat races, multiple-seat lost
increments, paid/guest hold ordering, cart and legacy holds, stale paid counters,
same-key replay, cross-tier key conflicts, per-email caps, invalid QR rows,
statement failures and transactional rollback. It fails if PostgreSQL is absent
or cannot start, rather than treating an unexecuted test as a pass. The dedicated
CI job runs the same harness without provider credentials.
