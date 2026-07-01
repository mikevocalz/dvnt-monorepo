# D7 — Integration Matrix

Two layers of test, scoped by what they can actually prove in CI vs. what
needs a real processor account.

## Layer 1 — SQL invariants (CI-runnable)

[`apps/mobile/supabase/__tests__/entitlement.integration.test.ts`](../apps/mobile/supabase/__tests__/entitlement.integration.test.ts)

Runs with `node --import tsx --test` against a Postgres URL passed in
`TEST_DATABASE_URL`. Skips cleanly when unset. No supabase boot required —
the RPCs are pure SQL and the webhook handlers are thin wrappers around
them, so testing the RPCs covers the invariants the webhooks enforce.

```sh
TEST_DATABASE_URL=postgres://… \
  node --import tsx --test apps/mobile/supabase/__tests__/entitlement.integration.test.ts
```

| Test                                                                              | Invariant | What it proves |
|-----------------------------------------------------------------------------------|-----------|----------------|
| `upsert_membership_subscription — happy path lands a row`                         | —         | RPC contract.  |
| `upsert_membership_subscription — stale event is rejected`                        | **I5**    | Out-of-order event with older `event_created_at` returns `false`; row state unchanged. |
| `upsert_membership_subscription — newer event applies and bumps last_event_at`    | **I5**    | Monotonic write moves the pivot forward. |
| `is_entitled — active web_stripe and ios_iap both resolve`                        | **I3**    | One read path; both rails resolve the same way. |
| `is_entitled — canceled past current_period_end returns null`                     | —         | Terminal state honored. |
| `is_entitled — past_due within grace_period_ends_at still active`                 | —         | Dunning grace honored. |
| `upsert_identity_verification — stale event rejected, monotonic wins`             | **I5** + D6 | Same monotonic guard on identity table. Out-of-order `failed` cannot overwrite `passed`. |
| `is_verified — true iff status=passed`                                            | **I3** + D6 | One read path for identity verification. |

## Layer 2 — Live round-trip (manual / staging)

These need real Stripe + RevenueCat test accounts + a deployed supabase
edge fn URL. The plan is the same in both directions, only the rail
changes.

### G4 forward — Web Stripe → Supabase → Native entitled (C4)

1. Sign in as `alice@dvnt.test` on `apps/web` (`/`).
2. `POST /api/checkout/session` with `planKey: 'dvnt_core'` →
   verify response includes `url` pointing at `checkout.stripe.com/...`.
3. Confirm `select * from stripe_customers where user_id = '<alice>'`
   returns a row created BEFORE the redirect (I1).
4. Complete checkout in Stripe test mode (`4242 4242 4242 4242`).
5. Verify `select status, rail, plan_key, last_event_at
   from membership_subscriptions where user_id = '<alice>'`
   shows `('active', 'web_stripe', 'dvnt_core', <recent>)`.
6. Open `apps/mobile` signed in as the same user; `useEntitlements()` must
   return the `dvnt_core` plan without any client-side RevenueCat call.

### G5 reverse — Mobile IAP → Supabase → Web entitled

1. Sign in as `bob@dvnt.test` on `apps/mobile`.
2. Confirm `loginRC(bob.id)` ran (look for the RC initialization log at
   sign-in).
3. Buy `dvnt_core` via the in-app purchase flow.
4. Verify the same `membership_subscriptions` query shows
   `(..., 'ios_iap', 'dvnt_core', ...)`.
5. Open `apps/web` signed in as Bob; `useEntitlements()` returns
   `dvnt_core` without any client-side Stripe call.

### Replay / idempotency

For each rail, replay the same webhook event id twice:

- **Stripe:** `stripe events resend <evt_…>` against the staging endpoint.
- **RevenueCat:** "Resend event" from the RC dashboard.
- **Persona:** "Resend webhook" from the Persona dashboard.

Confirm:
- One row in `stripe_events` / `rc_events` / `verification_events`.
- `membership_subscriptions` / `identity_verifications` unchanged on the
  second delivery (`last_event_at` same, status same).

### Identity-collision refusal (I1)

- Send a synthetic Stripe webhook with `metadata.dvnt_user_id` pointing
  at a `user_id` that has no `stripe_customers` row — the handler should
  still upsert (Stripe is the source of identity via metadata), but the
  monotonic guard means we MUST also test the opposite: a webhook for a
  customer whose metadata is missing entirely is logged + ignored
  (existing `if (!hostId || !planKey)` branch in `stripe-webhook`).
- Send an RC webhook with `app_user_id = '$RCAnonymousID:abcdef'` — the
  fn must return 400 `Anonymous app_user_id; refusing to provision`.
  Verified in code; covers the I1 path.
- Send a Persona webhook with no `reference-id` in the payload — the fn
  must return 400 `Missing reference-id`.

## What is intentionally NOT in CI

- Real Stripe Checkout completion (requires a browser and Stripe test
  card). Lives in the staging checklist above.
- iOS Add-to-Home-Screen install + Web Push subscription. Requires a
  real iPhone running iOS 16.4+; cannot be simulated.
- Persona Hosted Flow completion. Requires a Persona sandbox + a real
  ID document upload. Lives in the staging checklist.

Each manual step has a one-line assertion against Supabase — copy/paste a
SQL query, look for a row. The invariant the manual run is closing is
labeled (G4 / G5 / I1 / I2 / I5) so we know which gate moves on each pass.
