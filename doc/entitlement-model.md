# Entitlement Model

> Two rails, one row, one read. See [`../AGENTS.md`](../AGENTS.md) for the invariants
> the model has to uphold (I1–I6) and [`./existing-payment-audit.md`](./existing-payment-audit.md)
> for what was already in place before this work.

## One table

`membership_subscriptions` is the unified source of truth. Migration
[`20260630120000_subscription_rails_and_entitlement.sql`](../apps/mobile/supabase/migrations/20260630120000_subscription_rails_and_entitlement.sql)
adds three columns on top of the existing schema:

| Column          | Type        | Purpose                                                                    |
|-----------------|-------------|----------------------------------------------------------------------------|
| `rail`          | text enum   | `web_stripe` \| `ios_iap` \| `play_iap` — where the revenue came from.     |
| `provider_ref`  | text        | Normalised processor id. Stripe → `stripe_subscription_id`; RC → `original_app_user_id:product_id` (stable across renewals, transaction id is not). |
| `last_event_at` | timestamptz | Monotonic-guard pivot. Newer state never silently overwritten (I5).        |

`user_id` is still the unique key — one active row per user across rails. A user who
buys on iOS then switches to web is one row with a new `rail` after the next webhook.
No reconciliation table.

## One write path

Both webhooks call `upsert_membership_subscription(...)` — a security-definer SQL
function that does the upsert with a `WHERE last_event_at < EXCLUDED.last_event_at`
guard. Returns boolean: `true` = applied, `false` = stale event skipped. Both rails
log the `false` case so we can spot replay storms in dashboards without writing a
single line of dedicated alerting.

| Webhook                 | Auth                                | Dedup table        | Identity source                       | Rail set        |
|-------------------------|-------------------------------------|--------------------|---------------------------------------|-----------------|
| `stripe-webhook`        | HMAC v1 (manual)                    | `stripe_events`    | `metadata.dvnt_user_id` on Stripe sub | `web_stripe`    |
| `revenuecat-webhook`    | `Authorization: Bearer <secret>`    | `rc_events`        | `app_user_id` (from `Purchases.logIn`)| `ios_iap` / `play_iap` |

Both fail closed (I2) on missing secret / bad signature, dedup on event id (I2),
guard the row write on `event.created` / `event_timestamp_ms` (I5).

## One read path

```sql
SELECT public.is_entitled(uid := $user_id);
-- returns plan_key (text) or NULL
```

`is_entitled` is the single resolver. Active means:
- `status IN ('active','trialing')` and inside `current_period_end`, OR
- `status = 'past_due'` and inside `grace_period_ends_at` (dunning window).

Both `apps/web` and `apps/mobile` call this RPC; neither reads the row body, neither
calls a processor SDK on the client (I3). RLS lets `authenticated` execute it for
their own `auth.uid()` (the function is `SECURITY DEFINER`, so RLS on
`membership_subscriptions` doesn't leak the row body).

## Identity strategy

### Web (Stripe)
- `create-payment-intent` already creates `stripe_customers(user_id, stripe_customer_id)`
  at the FIRST purchase (I1). The bridge row exists before the first subscription
  webhook.
- D3 work: `apps/web` server route `POST /api/checkout/session` reuses the same
  helper so a web-only buyer (no prior native purchase) still gets the bridge row
  written before checkout completes.

### Mobile (RevenueCat)
- **Lock:** `Purchases.logIn(user.id)` at sign-in. `rc_app_user_id ≡ user.id`. No
  bridge table. The RC webhook resolves user_id directly from the payload.
- The webhook refuses to act on `$RCAnonymousID:*` payloads — if we got there, the
  mobile bootstrap is buggy and the purchase has no owner. That's a sev, not a row.

Documented separately so we never accidentally introduce a `revenuecat_users` table
"just in case." Two strategies (bridge vs. identity-equality) would defeat the
single-write-path simplicity.

## Why no `subscriptions` view

Spec wording suggested a new `subscriptions` table. We extended
`membership_subscriptions` instead because:
- The existing webhook + lifecycle handlers already point at it.
- The schema delta is three columns; a new table would force migrating live data plus
  rewriting `stripe-webhook` end-to-end.
- One table avoids the "which one wins" problem when web + mobile race on a transfer.

If a future surface needs a different rail enum or different cardinality (e.g., a user
holding two subscriptions at once for different product families), revisit.

## What this leaves for D3 / D4

- **D3** — `apps/web` server route, Zustand store + TanStack predicate cache reading
  `is_entitled` (no RevenueCat imports on web).
- **D4** — install `react-native-purchases` in `apps/mobile`, wire `Purchases.logIn`
  at sign-in, point the native entitlement hook at the same `is_entitled` RPC.
- **D7** — fixture replay tests for both webhooks; specifically:
  - Same `event.id` twice → exactly one row write.
  - Out-of-order `event.created` → older payload is skipped (logs `stale event
    skipped`).
  - Anonymous `app_user_id` → 400 with `Anonymous app_user_id; refusing to provision`.
