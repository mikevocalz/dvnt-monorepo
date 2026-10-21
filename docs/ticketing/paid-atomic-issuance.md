# Single-tier paid issuance transaction

This is a source-only change. Applying the new migration and deploying the matching
paid webhook/session/reconciliation adapters require separate release approval.
Never deploy the adapters first: an absent RPC must fail closed, not fall back to
split ticket/counter/hold writes. No historical rows are backfilled by the migration.

## Scope and contract

`paid_ticket_issuance_atomic(order_id, ticket_type_id, payment_intent_id,
checkout_session_id, amount_cents, ticket_rows)` is callable only by `service_role`.
It covers a single-tier paid hosted Checkout Session (guest or member) and a direct
native/door `event_ticket` PaymentIntent. It does not cover carts, free checkout,
upgrades, transfers, refunds, or checkout producer behavior outside the shared
legacy hold allocator. The same migration also replaces that allocator as described
below.

The adapter must first verify Stripe settlement and pass its authoritative positive
amount. The RPC requires that amount to equal the persisted order total and the
exact sum of generated integer per-ticket amounts. The adapter allocates any
remainder rather than rounding every ticket independently. Signed QR rows must
match order, tier, event, buyer and Stripe references; authoritative ownership and
grouping fields are fixed again on insertion.

Successful new issuance returns `ok: true`, `duplicate: false`, the order ID,
`issued_count`, and `{ id, qr_token, guest_lookup_token }` ticket records. A complete
compatible legacy replay returns `duplicate: true`, `issued_count: 0`, and the
existing records, even when its old hold is expired or absent. A complete replay
atomically converts coherent remaining active holds, floors the sold count at actual
kept tickets (without adding quantity), and binds a missing hosted-order PI. It never
adds or rewrites legacy tickets. Any partial or conflicting prior ticket set fails with
`ok: false, needs_recovery: true`; it must not be filled opportunistically.

An order already refunded, partially refunded, disputed or cancelled, or a
complete matching ticket set containing refunded/void tickets, returns a terminal
successful no-op: `terminal: true, duplicate: true, issued_count: 0, tickets: []`.
The adapter must preserve that terminal state and skip money-state, fulfillment
email and issuance side effects. `cancelled` is defensive; the current order CHECK
does not permit that status. Existing transferred/claimed ownership mismatches
require explicit recovery rather than guessing ownership or minting new tickets.

## Transaction and allocation

Lock order is payment-key advisory transaction lock, tier row, order row, then
matching legacy holds. It prevents same-payment retries, same-order retries and
new single-tier issuance from interleaving inventory writes. A second order already
claiming the same Stripe reference is a conflict, not a second fulfillment target. Complete nonterminal legacy bundles
must have nonempty QR tokens and active, scanned or transfer-pending status.

Hosted legacy holds store the Checkout Session ID in `payment_intent_id`; direct
native/door holds store the PaymentIntent ID. New issuance requires exact live hold
allocation for the purchased quantity, tier and event. Authenticated holds bind to
the order user. Hosted guest holds bind to normalized guest email. Door holds bind
to the order's recorded `sold_by_staff_user_id`, while tickets stay owned by the
guest, never the seller. Missing, expired, conflicting or already-converted holds
with no complete ticket set fail for recovery. Complete replays may repair expired
active holds, but contradictory active holds still require recovery. Settlement does not authorize a
new reservation, overselling or an automatic refund.

Capacity uses the greater of recorded `quantity_sold` and actual kept ticket rows
(all statuses except refunded/void), plus all other live legacy and cart holds.
The ticket/hold read uses one SQL snapshot. Overcounted legacy inventory and a
legacy insert-before-conversion handoff can conservatively block issuance. Paused
sales or later pricing changes do not invalidate an already-paid, valid reserved
allocation; admission and pricing are checked by checkout before payment.

All ticket inserts, sold-floor update, own hold conversion and hosted order PI
binding commit together. Any SQL failure rolls the entire operation back. Order
money-state remains with the existing guarded adapter path, so a post-commit retry
can repair it without issuing again. Email, Stripe calls, profiles, promo usage,
alerts and timeline writes are outside this RPC.

## Bounded shared hold-admission guard

The migration also replaces `ticket_hold_create_atomic(uuid, integer, text, text,
text, integer, text)` with the deployed function plus an authoritative sold floor.
It keeps the same tier lock, arguments/defaults, service-role-only grants, TTL clamp,
unlimited-tier fast path, hold states and return shape. For capped tiers only,
`greatest(quantity_sold, actual kept tickets)` replaces the sold-counter term, and
kept tickets plus both live hold sums are read in one SQL statement. The existing
`idx_tickets_ticket_type_id` index supports the additional count; no index or
historical data migration is added.

Operationally, native, hosted and door producers using this shared allocator can
no longer reserve extra seats solely because an old writer lowered the recorded
counter. It may conservatively reject an overcounted tier or legacy handoff, but
never changes counts, pricing, sale eligibility, refunds or ownership itself. A
failed allocation remains the producer's existing checked cancellation/expiry path;
this change reduces avoidable already-paid recovery cases without claiming all
admission rails are protected. `cart_create_hold` and any free writer bypassing
this function are explicitly unchanged.

## Limits and verification

This does not make every inventory writer atomic. Legacy refund/upgrade/counter
writers, cart admission and free writers bypassing the shared hold RPC still need
separate audits. Historical allocations can already exceed current capacity; paid
issuance surfaces those as recovery rather than inventing a reservation or
refunding automatically. Conservative actual-ticket floors protect this new
issuance rail from stale counters, but do not provide comprehensive inventory
reconciliation or prove global oversell safety. The old free guest rail remains
separate; its independently reviewed source-only fix is PR #161.

The dedicated `verify-paid-ticket-issuance.mjs` harness applies the actual source
migration to a disposable PostgreSQL cluster and uses independent connections with
lock-state barriers. It must pass in CI before the combined adapter/RPC draft is
considered verified. Local socket restrictions mean a skipped or blocked local
multi-connection run is not concurrency proof. The workflow must be triggered by
all edge-function and migration changes so cross-rail changes rerun these checks.
