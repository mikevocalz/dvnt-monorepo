# Delayed-tier visibility and cart sale windows

## What must be released

1. Review and apply `20261106120000_cart_hold_sale_windows.sql` after
   `20261031142216_repeat_purchase_tier_limits.sql`. This is a function-definition
   change, not a backfill. It changes no existing tickets, orders or holds.
2. Release the `ticket-upgrade` edge function to activate its shared sale-window
   guard. The ordinary ticket-checkout, payment-intent and guest-checkout rails
   already have this guard.
3. Release the customer UI changes to hide delayed tiers and reveal them at their
   opening time. Organizer tier editing continues to use the unfiltered records.

The cart migration is compatible with the existing edge handler. That handler
already returns RPC errors with their tier ID. UI or edge deployment alone does
not install the cart SQL guard. No production migration or deployment was run as
part of this source change.

## Cart behavior and limits

New and renewed cart reservations reject future starts, elapsed ends, infinite
bounds, and reversed/empty windows. Null bounds remain supported. The function
locks the cart, its existing lines, and their tier rows before sampling wall time
and checking every tier. A failure in this date preflight does not release holds,
reprice lines, or reserve part of the selection within the RPC.

The existing cart-line foreign key makes new inserts acquire a key-share lock on
the cart, conflicting with the RPC's cart lock. Existing line locks block retargets,
quantity changes and deletes. Tier locks serialize organizer date edits. This
assumes the production foreign key remains the one defined in the migrations.

The edge handler's existing unpaid-cart rebuild still releases old holds and
replaces lines before invoking the RPC in separate requests. This change does not
make that rebuild transactional or restore an earlier selection if it is rejected.
Paying carts / carts with a PaymentIntent remain protected by the existing edge
handler's early rejection before edits.

Previously held carts are deliberately not invalidated. Checkout and paid
fulfillment/recovery remain unchanged, including idempotent payment replay. A hold
created before this migration may still complete, even if the tier's date is now
in the future. There is no retroactive guarantee for those already-authorized
reservations. Normal renewal must satisfy the new sale-window checks.

## Validation

The mandatory cart handler suite checks date-error passthrough, frozen payment
carts, lock/check ordering, and that the existing allocator is otherwise unchanged.
The optional SQL suite executes real migration SQL in in-memory PostgreSQL via
PGlite, reproduces the prior bypass, applies the new migration twice, and checks
mixed carts, opening/closing boundaries, invalid windows, renewal, unchanged
caps/visibility, add-on-only carts, grants, and old-held payment completion/replay.
PGlite is single-session; multi-session lock contention was not executed. These
are synthetic tests, not a live-database validation.

Run without adding repository dependencies:

```sh
npm_config_cache=/tmp/dvnt-npm-cache npm install --prefix /tmp/dvnt-tier-test-deps --no-save @electric-sql/pglite
NODE_PATH=/tmp/dvnt-tier-test-deps/node_modules npm run test:cart-sale-windows:sql
```

The mandatory handler suite also needs TypeScript, as it did before this change.
