# Configured free units never incur a flat fee

## Narrow rule
- Configured zero-price ticket and add-on units contribute **zero** flat fees,
  including when a paid item shares the cart. Inventory/order quantity still
  counts every unit; fee quantity counts positive-price units only.
- Zero-total fee-calculator inputs return zero buyer/organizer/platform fees and
  zero charge. The existing all-free cart rail safely refuses before Stripe;
  this change does not invent free cart fulfillment.
- Existing paid-unit percentage, rounding, refund, fee-mode and promoter/promo
  behavior stays unchanged. Effective per-unit allocation for discounts (such
  as BOGO or fully discounted admission beside a paid add-on) is a separate
  unresolved ledger concern; this patch does not claim to solve it.

## Verified production evidence (read-only, 2026-10-30 04:43 UTC)
- `cart-checkout` v41 passes all units to fee calculation; its live pricing
  helper increments quantity for zero-price lines too.
- Live accounting counts every nonvoid/nonrefunded ticket as a $1 fee unit.
- 950 zero-price active tickets in26 events;6 mixed-revenue events. Excluding
  zero-price units reduces calculated fees by$950 and increases pre-promoter
  event net by$763. Current cached totals match those deltas. No affected event
  is marked payout released; no missing cached summaries.
- No paid order with zero subtotal and positive total; no zero-total order with
  nonzero fee columns. Two zero-price tickets are on fee-bearing paid mixed
  orders. These facts are NOT proof of provider-settled charges on free tickets.
- `payouts-release` v55 recomputes event financials, then subtracts promoter cuts
  before creating Stripe transfers. This is financially material, not UI-only.

## Approval / release boundary
The source migration `20261030050000_free_units_never_have_fees.sql` replaces
only the existing calculation and preserves its grants. It does not repair
cached rows. Applying it affects future recomputations and future payouts.
The separate `free-units-cache-repair.sql` is an operator artifact, **not an
automatic migration**. It must not run without explicit approval of the measured
fee/net changes and coordination that no payout execution is racing it. Its
aggregate checks abort/roll back if the reviewed snapshot has changed.

No refund, payment, payout, ticket ownership or recipient message is authorized
by this patch. Preserve live dependency drift when publishing cart-checkout and
any explicitly reviewed fee-helper closure. Web merge does not deliver native UI.

The older PR181 migration keeps zero-price mixed-cart units fee-bearing when
an order recorded fees; do not deploy it as this stricter rule.
