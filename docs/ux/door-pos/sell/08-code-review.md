# Sell — engineering code review (step 10)

Review of the Phase 4 Sell diff (`736149c` + follow-ups). Findings first,
then the checklist.

## Findings — fixed before merge

1. **Hold rebinding could collide across sellers (fixed).** The first
   cut created the atomic hold with a `door_pending_*` placeholder PI id,
   then rebound via `.eq("ticket_type_id", …).like("payment_intent_id",
   "door_pending_%")`. Two sellers holding the same tier concurrently
   would both match that predicate — one's rebind could rewrite the
   other's hold. Reordered to mint the PaymentIntent *first* and pass the
   real `pi.id` into `ticket_hold_create_atomic` in a single write, and
   on hold failure the PI is cancelled (same shape as
   `create-payment-intent`). No placeholder exists anymore.
2. **Order-insert failure stranded PI + hold (fixed).** If the `orders`
   insert threw after the hold succeeded, the PI stayed live with no
   order to reconcile. The insert failure path now cancels the PI and
   releases the hold.

## Findings — open / ticketed

- **Per-guest `max_per_user` not enforced on door sales.** Online
  checkout caps tickets per buyer identity; a door sale could exceed it
  for a repeat guest email. Low risk at a door (each sale is a different
  human), but the check exists in `ticket-checkout` and should be ported
  — ticketed.
- **`quantity_total` remaining is computed client-side** for the sold-out
  badge (`quantity_total − quantity_sold`, holds not included). Display
  only — the atomic hold is authoritative at sell time — but the row can
  show "available" while holds have consumed the last seats. The
  `sold_out` response handles it honestly; a server-side remaining field
  would tighten it. Ticketed.
- **`preparing → fulfilled` is a 1.5s timer, not webhook confirmation.**
  The screen treats `confirmPayment` success + a short wait as
  "fulfilled", which is a presentation choice (tickets arrive by email
  regardless) — but the copy "Tickets sent" can briefly precede actual
  issuance. Acceptable P0; a `get-order-status` poll keyed on the order
  id would make it truthful. Ticketed.
- **`sold_out` on `sell` returns 409 with `code`, but `quote` does not
  check inventory.** A tier that sells out between list-load and Apply
  still quotes fine; the failure lands at sell. Intended (quote is
  read-only), documented.

## Money-path checklist

- [x] Integer cents end to end; no floats.
- [x] Server computes subtotal/discount/fees/total; client sends no
  amounts (`doorApi` has no amount params).
- [x] Seller identity from `verifySession`, never the body.
- [x] Buyer = guest email; tickets mint `user_id NULL` + lookup token;
  `sold_by_staff_user_id` lives on the order only.
- [x] Same atomic hold RPC as online checkout.
- [x] Web PI uses `automatic_payment_methods`; no
  `payment_method_types`; no Terminal imports in web code.
- [x] Fulfillment from `payment_intent.succeeded` webhook; idempotent on
  existing `stripe_payment_intent_id` ticket count check.
- [x] Free path issues real tickets with no Stripe object.
- [x] Promoter snapshot written on the order at sell time; attribution
  via `record_promoter_attribution` / webhook `recordPromoterEarning`.
- [x] Response carries no event totals, order lists, payouts, other
  staff sales, or bank data — quote + ids only.
- [x] `verify_jwt = false` in config.toml (function does Better Auth
  session verification itself, matching siblings).

## Tests

- `door-sale.test.cjs` — 6 passing tests: metadata parsing, seller never
  ticket owner, deterministic amount split summing to the charge,
  guest-email requirement, email masking.
- Still needed (tracked in handoff): race test (2 door sellers + 1
  online buyer on the last seat), decline/retry path, access-control
  probe calling door-sell as non-staff and as a promoter.
