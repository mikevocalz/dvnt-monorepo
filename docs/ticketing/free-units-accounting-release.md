# Configured free units do not incur flat fees

Configured zero-price ticket/add-on units contribute zero flat fees, even when
a paid item shares the cart. Inventory quantity still counts all units; fee
quantity counts positive-price units. Zero-total calculators return zero fees.
The existing all-free cart rail still refuses before Stripe; this does not add
free-cart fulfillment. Existing paid and discount behavior stays unchanged.
Per-unit discount allocation in mixed carts remains a separate ledger concern.

## Transactional deployment template

The source migration changes only the existing calculation. For a live rollout,
use `free-units-accounting-release.sql`: one transaction installs the function,
locks the targeted rows, verifies approved bounds and repairs derived caches.
A failed guard rolls back the function definition and every cache write.
Do not apply the formula and cache repair as separate live transactions.

The `__EXPECTED_*__` tokens MUST be filled from a separately reviewed, private
read-only audit immediately before execution. Never commit production financial
measurements or approval conversations to this repository. Missing substitutions
fail closed. Review affected event/unit counts, fee/net changes, unknown prices,
current payout states and in-flight payment exposure. Coordinate payout runs.

This operation changes future derived net calculations; it does not issue
refunds, payments, transfers, ticket changes or recipient messages. Existing
PaymentIntents are not repriced or cancelled. Preserve unrelated deployed helper
drift and verify exact published sources after an approved release.

Tests use unrelated synthetic fixtures and a disposable PostgreSQL instance.
