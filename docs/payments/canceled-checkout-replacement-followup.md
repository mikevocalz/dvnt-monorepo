# Follow-up contract: safely replace a canceled checkout

The integrated draft retires an exactly proved zero-money canceled attempt from automatic polling. It deliberately does not authorize a replacement charge. End-to-end canceled-checkout retry remains unfinished.

## Current blocks

- Authenticated same-selection preparation rejects an earlier created/payment-pending/payment-failed checkout. A fresh request key does not bypass that guard.
- A repeated key returns the original immutable attempt; it does not create another provider payment. Guest replay requires secure recovery rather than an email/order ID alone.
- A cart is locked and `orders.cart_id` is unique. Existing order/payment links and economic snapshots are immutable. Polling retirement must not clear or overwrite them.

## Required proof and authorization

A replacement action must come from the authenticated original buyer, or an independently verified guest recovery session, and must prove ownership of the exact original selection/cart. A forged actor, email, order ID, cart ID or client assertion of cancellation must never authorize it.

Retrieve the exact bound provider PaymentIntent and hosted Checkout Session when applicable. Require final cancellation, zero amount received, no successful/captured charge, matching order/model/currency/economics and consistent hosted unpaid/expired evidence. No source enrollment, reserved/uncertain transfer, refund/dispute/outflow, recovery, external settlement, conflicting new payment or fulfilled ticket may exist. Zero search matches, an expired session alone, processing/requires-payment-method, time elapsed and a missing response are insufficient.

Use a single serialized, idempotent replacement authorization with durable lineage. Concurrent retries must create at most one successor and one provider dispatch. Preserve the original attempt and proof permanently. The successor needs a fresh server-authoritative price/availability snapshot and explicit buyer acceptance of any changed total. Revalidate event sale windows, inventory, promoter identity/economics, cohort policy and funding policy.

For carts, design a reviewed attempt/lineage model that preserves the existing unique ownership and historical evidence. Do not solve the uniqueness guard by deleting the old order, nulling its cart ID, reassigning cart ownership, or overwriting its PaymentIntent. Inventory/hold renewal and any new attempt relationship need an atomic design before schema or API changes.

## Required regression matrix

- Authenticated owner versus another user, switched session, anonymous caller and guessed original IDs.
- Guest verified recovery versus email-only/order-only claims, replayed/expired recovery capability and authenticated/guest crossover.
- Cart owner versus another cart/user; stale/expired inventory, changed selection/pricing, already-paid/fulfilled cart and simultaneous replacements.
- Exact canceled zero-money proof versus partial captured funds, successful/processing/requires-payment-method intent, wrong account/currency/order/model, malformed/missing fields, lost response, expired hosted session with a live intent and multiple provider matches.
- Any prior source/transfer/refund/dispute/external/recovery evidence blocks replacement, including races that commit immediately before authorization.
- Crash before/after provider success, duplicate requests, DB persistence failure and webhook arriving late: no double charge, no overwritten history and no automatic retry on an unknown successor outcome.
- All paid rails, real endpoint authorization, mounted web/native retry flows and isolated native PostgreSQL races. Dedicated provider sandbox validation remains required; live context is not a substitute.

This is an engineering follow-up contract, not permission for live charges, data changes or a relaxed checkout guard.
