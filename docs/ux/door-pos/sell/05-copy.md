# Sell — copy table

Every string on the Sell screen: state, string, reason. Money words are
literal (charged / not charged / held); buttons are verbs with objects.
Say what happened, then what to do.

| State / element | String | Reason |
|---|---|---|
| Mode tabs | `Scan` · `Sell` · `Staff` | Peers, one tap. `Staff` absent for scanners, not locked. |
| Screen title | `Sell tickets` | The job, plain. |
| Tier row | `{tier name}` · `{price}` · `Sold out` | Sold out is a word, not grey alone. |
| Stepper buttons | `−` / `+` with `aria-label="Remove one {tier}"` / `"Add one {tier}"` | Icon-only controls need names. |
| Quantity value | `{n}` announced via live region | SR hears the count change. |
| Guest email label | `Guest email` | What it's for is stated next: |
| Guest email hint | `Tickets are sent here.` | Why we ask, one line. |
| Guest email error | `Enter an email to send the tickets to.` | What happened + fix. |
| Code label | `Promoter or discount code` | One field, both code types. |
| Code placeholder | `CODE` | Uppercase sets the expectation. |
| Code apply button | `Apply` | Verb. Enter key does the same. |
| Code checking | `Checking code…` | Honest pending state. |
| Code applied | `{CODE} applied — {pct}% off` | Named code, sized effect, at apply time. |
| Code invalid | `That code doesn't work for this event.` | No blame, no raw API error. |
| Code paused | `This code is paused right now.` | Distinct from invalid. |
| Code wrong event | `This code is for a different event.` | Distinct from invalid. |
| Subtotal line | `Subtotal` · `{amount}` | Shown when a discount applies. |
| Discount line | `{CODE} −{pct}%` · `−{amount}` | Names the code on the money line. |
| Total label | `Total` · `{amount}` | Server quote only. |
| Pay button ready | `Charge {amount}` | e.g. `Charge $45.00`. Carries the total. |
| Pay button quoting | `Getting total…` (disabled) | Says why it's disabled. |
| Pay button empty | `Select tickets` (disabled) | The next action, not "disabled". |
| Holding inventory | `Holding {n} tickets` · `Cancel` | Hold is named, cancellable. |
| Awaiting payment | `Hand the phone to the guest to pay.` · `Cancel` | What the seller does now. |
| Processing | `Confirming with the bank…` | Literal. No second pay button. |
| Paid, preparing | `Payment received. Preparing tickets.` | Wait state that auto-advances. |
| Fulfilled | `Tickets sent to {masked email}.` + `{amount} · card ··{last4}` | Proof for the guest. |
| Fulfilled actions | `Next customer` · `Check in now` | Check-in is a separate explicit act. |
| Check-in confirm | `Check in {n} guests now? This admits them.` | Names the consequence. |
| Declined | `Card declined. Nothing was charged. Try another card.` | Happened → fix. Plain reason appended if Stripe gives one. |
| Canceled | `Sale canceled. Nothing was charged.` · `Start over` | Hold released, says so. |
| Expired | `That took too long — the hold expired. Nothing was charged.` · `Start over` | Literal, no jargon. |
| Sold out during sale | `{Tier} sold out while you were selling. Nothing was charged.` · `Pick another tier` | Never charge-then-fail. |
| Offline | `No connection. Sales are paused.` · `Retry` | Scanning status is separate. |
| Not authorized | `Your access to this event ended.` · `Back to my events` | Revoked mid-shift, honest. |
| Payments not ready | `This event can't take payments yet. The organizer hasn't finished setup.` | Managers get `Finish setup`; scanners see the plain message only. |
| Zero-total order | `Confirm free order` | Real free-order path; no fake charge. |
| Free-order success | `Tickets sent to {masked email}. No charge.` | Literal money state. |
| Live-region announcements | `Total {amount}` · `{CODE} applied` · `Payment received` · `Card declined. Nothing was charged.` | `aria-live="polite"`, one announcer. |

## no-ai-slop pass (detect)

Ran the table against the slop patterns: no "Oops", no "Something went
wrong", no "Success!", no exclamation padding, no "please" stacking, no
vague verbs ("Submit", "Continue" as a dead end), no em-dash decoration in
buttons. `—` appears only inside the discount readout `ANDRE applied —
10% off` where it separates two facts; acceptable per house copy. The
expired string "That took too long" is deliberate plain speech; it names
the cause without blaming the seller or the guest.

Fixed during the pass: `Getting total…` replaces "Calculating…" (truer:
the number comes from the server); `Hand the phone to the guest to pay.`
replaces "Awaiting payment" (says the action, not the state).
