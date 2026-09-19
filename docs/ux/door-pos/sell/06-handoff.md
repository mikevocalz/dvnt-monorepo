# Sell — design handoff spec

## Route and shell

- New web route `feed/events/[id]/door` → dynamic-imports
  `@dvnt/app/features/events/door.web`.
- Top of screen: peer mode tabs `Scan | Sell | Staff` (`Tabs` from
  `components/ui`). `Staff` renders only for roles that may manage staff
  (per `useEventRole`); absent, never locked. `Scan` navigates to the
  existing scanner surface; `Staff` to the existing staff surface — both
  already exist, so the door route is a shell plus the new Sell panel.
- Event name in the header; back to event. Role gate on mount:
  `canScanTickets` (sellers) or higher; otherwise the not-authorized state.

## Components and props

| Component | Props | Notes |
|---|---|---|
| `DoorShell` | `eventId`, `mode: 'scan'|'sell'|'staff'` | Owns tab bar + role gate. |
| `SellPanel` | `eventId` | The screen this spec covers. |
| `TierRow` | `tier`, `quantity`, `soldOut`, `onStep(delta)` | `surface` row, `radius.md`, hairline; stepper hidden/disabled when `soldOut`; `accessibilityRole="button"` on ±, `aria-label="Add one {name}"`. |
| `QuantityStepper` | `value`, `min=0`, `max`, `onChange` | 48pt hit areas; value in `aria-live="polite"` region. |
| `CodeField` | `value`, `status: idle|checking|applied|invalid|paused|wrongEvent`, `onApply` | `Input` w/ `autoCapitalize="characters"`, `autoCorrect={false}`, Enter applies; inline result row under field. |
| `PayBar` | `quote`, `state`, `onCharge`, `onCancel` | Sticky bottom, `glass.bg` + blur, safe-area padding; contains total readout + `Button`. |
| `SaleStatus` | `state`, `detail` | Inline panel for processing/fulfilled/declined/etc.; `role="status"`. |

`quote` is the server quote shape: `subtotal_cents`,
`discount_cents`, `discount_label` (code), `total_cents`, `currency`.
The client never totals.

## State matrix (ships all of these)

From `dvnt-payments-ux`, mapped to this screen:

| State | UI | Primary action |
|---|---|---|
| Loading tiers | Skeleton rows | — |
| Ready / empty selection | Tier rows, `Select tickets` disabled | pick a tier |
| Quoting | Skeleton total, `Getting total…` disabled | — |
| Ready with quote | Total + `Charge $X` | charge |
| Holding inventory | `Holding {n} tickets` | `Cancel` |
| Awaiting payment | PaymentElement sheet + instruction | `Cancel` |
| Processing | `Confirming with the bank…` | — (no back-nav to re-charge) |
| Paid, preparing | `Payment received. Preparing tickets.` | wait, auto-advance |
| Fulfilled | masked email, amount, last4 | `Next customer`; `Check in now` |
| Declined | reason + nothing-charged | `Try another card` |
| Canceled / Expired | nothing-charged copy | `Start over` |
| Sold out during sale | tier-named message | `Pick another tier` |
| Offline | `No connection. Sales are paused.` | `Retry` |
| Not authorized | `Your access to this event ended.` | `Back to my events` |
| Payments not ready | setup message | (manager) `Finish setup` |
| Zero total | `Confirm free order` | secure free path, no Stripe sheet |

## Server contract (money path)

- Quote: `POST` to the existing checkout/hold path (cart or ticket
  checkout) — exact endpoint chosen at build; returns the `quote` shape.
  Client sends event, tier, quantity, code, and `sold_by_staff_user_id`
  context — never amounts.
- Inventory: same atomic hold RPC online checkout uses
  (`ticket_hold_create_atomic` / cart holds). No parallel door hold.
- Payment: `PaymentIntent` via existing pipeline; web omits
  `payment_method_types` (uses `automatic_payment_methods`). Confirm with
  `@stripe/stripe-js`; fulfill via webhook, not the confirm return.
- Order records `sold_by_staff_user_id` ≠ buyer/owner/promoter/recipient.
- Zero-total orders take a secure free-order path, no fake payment.
- Check-in after sale is a separate call to the existing scan/check-in
  endpoint with its own record.

## Breakpoints

- 390: one column; sticky `PayBar` above safe area + keyboard; steppers
  48pt; `Charge` button full width.
- 768: form left ~60%, summary card right ~40%; pay button in card.
- 1280: same two columns, max-width ~960 centered; full tab order;
  `Enter` applies code / confirms sheet; `Esc` closes sheet; focus returns
  to `Charge` on close.

## Motion

- Sheet open/close and success reveal only; ≤400ms; use `motion.ts`
  durations. `prefers-reduced-motion` → instant swap, no slide. No
  confetti, no looping spinners without words.

## Accessibility

- One `role="status"`/`aria-live="polite"` announcer: total changes, code
  result, payment result.
- Contrast: text ≥4.5:1 on `ink`/`surface`; controls ≥3:1. Status always
  icon + word.
- 200% text without clipped totals or a hidden pay button.
- Steppers, rows, tabs all reachable by keyboard; focus ring `color.cyan`.

## Edge cases

- Code typed then tier changed → re-quote; applied code persists across
  quantity changes but is revalidated server-side.
- Hold expires while the Stripe sheet is open → `Expired` state on
  confirm; never charge without a live hold.
- Two sales back to back → `Next customer` clears email, code, quantities.
- Backgrounding the browser mid-payment → resume by order id on return;
  never mint a second PaymentIntent for the same order.
- Camera-denied scanner → Sell/Staff still reachable; Sell never requires
  the camera.

## Tests to write first

1. Server quote shown verbatim incl. ANDRE on $50 → `Charge $45.00`.
2. `sold_by_staff_user_id` recorded; ticket owner is the guest email.
3. Two sellers + one online buyer race the last seat → one wins, others
   get `Sold out during sale`, nobody double-charged.
4. Decline → nothing charged → retry uses same order, not a new intent.
5. Free order path issues tickets with `No charge`.
6. Scanner role sees no totals/orders/payouts fields in API responses.
