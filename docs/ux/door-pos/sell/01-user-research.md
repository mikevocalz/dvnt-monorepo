# Sell — user research (one page)

No interviews were possible tonight. This page works from the conditions in
`dvnt-payments-ux` and Mike's notes in PROMPT.md, and says so.

## Who uses this screen

The **door seller** — a staff member the organizer invited as `scanner` or
`editor`/`admin` on `event_co_organizers`. Often a volunteer or a friend's
friend, not a trained cashier. They opened the event on their own phone in a
browser, possibly minutes ago.

The **guest** is standing in front of them, cash-app or card in hand, in a
line. The guest hands money to a stranger's phone and wants a ticket and a
receipt they trust.

The **organizer** is not the user of this screen but is the person who
answers for every mistake it makes: oversells, wrong prices, misattributed
promoter codes, double charges.

## Conditions

- Dark venue, phone held in one hand, weak signal, other apps competing.
- A line behind the guest. Every extra tap is a person waiting.
- The screen must be readable at arm's length in the dark and operable
  with thumbs and 48pt+ targets.
- Sessions get interrupted: another guest, a phone call, the browser
  backgrounded. The sale state must survive or fail honestly.

## The job

Sell a guest the right tier, at the server's price, with an optional
promoter code, take payment through Stripe's UI, and deliver real tickets
to the guest's email — fast enough that the line doesn't notice.

## The three worst things that can happen

1. **Charge the wrong amount or the guest twice.** A client-computed total,
   a stale quote, a retry that issues a second PaymentIntent, or a hold that
   expires mid-payment. Mitigations: server quote only, amount on the pay
   button, stable idempotency on the order, explicit hold expiry.
2. **Sell a ticket that doesn't exist.** Door POS and online checkout race
   for the last seat. Mitigation: the same atomic inventory hold as online
   checkout, and a "sold out during sale" state, never charge-then-fail.
3. **Misattribute or lose the sale.** A promoter code applied to the wrong
   event, a seller recorded as the ticket owner, tickets that never reach
   the guest. Mitigations: server-side code validation per event,
   `sold_by_staff_user_id` separate from buyer/owner, guest email delivery
   from the webhook, never the seller.

## What the seller must never see

Event revenue, order lists, payouts, other staff's sales, bank data. The
scanner and seller roles are door operations, not finance. Forbidden fields
must be absent from API responses, not hidden in the UI.
