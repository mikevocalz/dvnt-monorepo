# ADR 004 — Ticket add-ons: who owns them, how they are counted, where they are sold

Status: accepted
Date: 2026-10-09

## Context

PR #61 fixed add-on pricing, refunds, financials and scanning, and left ten
defects open. Three of them needed a rule before they could be fixed or
struck: which ticket an add-on belongs to, how many door codes a multi-unit
add-on gets, and whether door-sell sells add-ons.

## Decision 1: an add-on purchase is bound to a ticket on the same cart

`order_addons.ticket_id` is set by `cart_complete_issuance`
(migration `20261009100200`). For each add-on line it picks an admission
ticket issued on the same cart:

1. a ticket of the tier the add-on requires (`ticket_addons.requires_tier_id`), if any;
2. otherwise the lowest `order_index` on the cart.

An add-on-only cart (the post-purchase upsell) issues no ticket, so its rows
keep `ticket_id` NULL and stay owned by `user_id` / `guest_email`.

What follows from the binding:

- `transfer-ticket` accept moves the unredeemed, unrefunded add-ons bound to
  the ticket to the recipient and re-mints their door codes.
- `execute_event_consolidation` already moves add-ons by `ticket_id`.
- `get-guest-ticket` and the Apple pass show rows bound to the ticket plus
  unbound rows on its cart (`_shared/ticket-addons.ts`). A row bound to
  another ticket is not shown, so one attendee in a group order cannot see or
  redeem another attendee's code.

Rows issued before `20261009100200` keep `ticket_id` NULL. No backfill was
written: production had no `order_addons` rows on 2026-10-09.

## Decision 2: one door code per redeemable unit

`redeem_addon` (`20260806300000`) is a compare-and-set on the whole row: one
scan sets `status = 'redeemed'`. It has no unit counter. Keeping one code for
a line of three drinks spent all three on the first scan. Changing the door
to count units would mean a new column, a new redeem function and new
ticket-scan responses, so issuance changed instead:

- `_shared/cart-issuance.ts` mints one signed code per unit of a redeemable line.
- `cart_complete_issuance` writes one row with `quantity = 1` per unit when it
  receives one code per unit. If it receives fewer (an edge function deployed
  before the migration), it writes the old single row so issuance never fails.
- A non-redeemable line has nothing to scan and stays one row.

Refunds already loop over every row of a line. `cart-line-refund` still
refuses a line once any of its units is redeemed; a full charge refund
(organizer-refund, event-cancel) returns the rest.

## Decision 3: door-sell does not sell add-ons (STRIKE)

door-sell (PR #52, Tap to Pay) sells one tier per sale with no cart:
`ticket_hold_create_atomic`, a PaymentIntent with `ticket_type_id` and
`quantity` in its metadata, then a direct `tickets` insert in the webhook's
door branch (or `door_free_sale_atomic` for free tiers). Add-ons are issued
only by `cart_complete_issuance`, from cart lines and cart holds.

Selling an add-on at the door would mean either moving door-sell onto the
cart rail (cart holds, `cart_complete_issuance`, a new Terminal flow) or
writing a second add-on issuance path into the door webhook branch and the
free-sale RPC, with its own stock and refund handling. The first rewrites a
payment flow that merged on 2026-10-08; the second duplicates the logic this
ADR just made consistent. Neither has a clear path inside door-sell's
current design, so it is struck.

The cost: door sales issue guest tickets (`doorGuestTicketBase`), and the
add-on-only cart behind "Add more for this event" needs a member-owned
ticket, so a door buyer cannot add add-ons afterwards either.

Revisit if door-sell moves onto carts.
