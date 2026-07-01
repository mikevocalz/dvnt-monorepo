# Existing Payment Surface — Audit (pre-D2)

Five edge functions touch payment in `apps/mobile/supabase/functions/`. Audit before
writing anything new (per [`../TASKS.md`](../TASKS.md) D2 step 1).

## stripe-webhook (1866 lines) — IN GOOD SHAPE

Handles: `checkout.session.completed`, `payment_intent.*`, `charge.*`, `customer.subscription.*`,
`invoice.paid`, `invoice.payment_failed`, `account.updated`, `transfer.reversed`, `payout.failed`,
`radar.early_fraud_warning.created`, `dispute.*`.

Posture vs invariants:

| #  | Status | Notes |
|----|--------|-------|
| I1 | ✅     | `stripe_customers(user_id, stripe_customer_id)` bridge written at `create-payment-intent` BEFORE first purchase webhook. Subscription metadata also carries `dvnt_user_id`. |
| I2 | ✅     | `stripe_events` table dedup by `event.id`. Hard-fail if `STRIPE_WEBHOOK_SECRET` missing. |
| I4 | ✅     | Manual HMAC v1 signature verification. Supports both account + Connect webhook secrets. |
| I5 | ⚠️ GAP | Upserts use `onConflict: user_id` — a delayed/replayed event could overwrite newer state. **D2 must add a `last_event_at` or compare `event.created` before write.** |
| I6 | ✅     | Service-role and webhook secret read from `Deno.env`, never returned to client. |

Subscription state lives in `membership_subscriptions(user_id, product_family, plan_key,
status, stripe_subscription_id, stripe_price_id, stripe_customer_id,
current_period_start, current_period_end, cancel_at_period_end, canceled_at,
last_synced_at, updated_at)` and the legacy `sneaky_subscriptions(host_id, plan_id, ...)`.

Audit/dedup: `membership_subscription_events` unique on `stripe_event_id`.

## create-payment-intent (487 lines)

Creates a Stripe Customer on first purchase, persists row in `stripe_customers`. **The
identity bridge already exists** — `dvnt_user_id` metadata set on customer at creation
time (`metadata[dvnt_user_id]`). This is the I1 row.

## purchases (405 lines)

Misnamed for a payments audit — this is order/refund history fetcher (`list`, `detail`,
`receipt`, `invoice`, `refund_request`, `refunds`, `disputes`, `ticket_print`). No payment
state mutation. Out of scope for D2/D3.

## payment-methods (224 lines)

Saved card CRUD. Out of scope for D2/D3.

## promotion-webhook (243 lines)

Promo code usage callback. Out of scope.

## Gaps vs. the spec (D2/D3 work)

1. **No `rail` column** on `membership_subscriptions`. Add it. Web Stripe rows → `rail = 'web_stripe'`; mobile RC rows → `rail = 'ios_iap'` / `'play_iap'`.
2. **`provider_ref`** isn't normalised — for Stripe it's `stripe_subscription_id`; for RC it'll be the original transaction id. Either rename the column or add a normalised `provider_ref` mirror.
3. **No RevenueCat anywhere.** `react-native-purchases` not installed; no webhook fn; no RC user-id bridge. D4.
4. **No unified `is_entitled(user_id)` SQL function or RPC.** Today the client would have to read `membership_subscriptions` directly. Add an RPC so web + native read the same way (I3).
5. **Monotonic guard (I5).** Add `last_event_at timestamptz` + `WHERE last_event_at < $event.created` predicate on the upsert. Stops stale replays from overwriting newer state.
6. **apps/web has client Stripe SDK only** (`@stripe/stripe-js`, `@stripe/react-stripe-js`); no server route creates checkout sessions or writes the bridge row. D3 owns this.

## Decision points for D2

- **Reuse `membership_subscriptions` (add columns) vs. new `subscriptions`** — reuse. Less migration cost, existing handlers stay live. (Question this if the legacy `sneaky_subscriptions` rows would conflict — they're keyed on `host_id`, not `user_id`, so no clash.)
- **Extend existing `stripe-webhook` vs. fork a web-only fn** — extend. Same Stripe account, same dedup table, same secret-handling. Only the `rail` write differs by checkout context (set in metadata at create-checkout-session).
- **Identity for RC** — `Purchases.logIn(user.id)` so `rc_app_user_id === user.id`. Simpler than maintaining a bridge table; the RC webhook resolves user_id directly from its payload.
