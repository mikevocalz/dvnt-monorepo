# TASKS — DVNT Web-First Build-Out

See [AGENTS.md](./AGENTS.md) for the full contract (bar, invariants, constraints).
Each deliverable below maps to a gate; do not start the next until the prior gate is green.

## D0 — Scaffold ✅
- [x] `AGENTS.md`
- [x] `CLAUDE.md`
- [x] `TASKS.md`
- [x] `config/defaults.json`
- [x] `doc/` directory

## D1 — Stripe processor risk (C1) → gate G2 ✅
- [x] `doc/processor-risk.md` written. **Verdict: GO for Stripe on Lynk.** Lynk is
      video chat, not adult content — not in Stripe's restricted-businesses list.
- [x] Existing `stripe-webhook` is the web rail. No processor abstraction, no CCBill /
      Verotel adapters. YAGNI; re-open if Lynk surface ever broadens to adult content.

## D2 — Entitlement model → gate G3 ✅ (build) / fixture pending
- [x] Audit — [`existing-payment-audit.md`](./doc/existing-payment-audit.md).
- [x] Migration [`20260630120000_subscription_rails_and_entitlement.sql`](./apps/mobile/supabase/migrations/20260630120000_subscription_rails_and_entitlement.sql)
      — `rail`, `provider_ref`, `last_event_at` on `membership_subscriptions` + backfill.
- [x] `is_entitled(uid text)` RPC (security-definer) — single read path for both rails (I3).
- [x] `upsert_membership_subscription(...)` RPC — monotonic guard server-side (I5 closed).
- [x] `stripe-webhook` extended — calls the upsert RPC with `rail='web_stripe'`,
      `provider_ref=sub.id`, `event.created` as the guard pivot. Stale events log + no-op.
- [x] `revenuecat-webhook` new fn — Bearer auth, `rc_events` dedup, refuses anonymous
      `app_user_id`, maps store → rail (`ios_iap`/`play_iap`), reuses the upsert RPC.
- [x] Identity: `Purchases.logIn(user.id)` — documented; D4 wires it client-side.
- [x] [`entitlement-model.md`](./doc/entitlement-model.md) — schema, RPCs, both webhooks, identity.
- [ ] Fixture replay in dev (D7 owns the full matrix; this is the G3→G4 sanity).

## D3 — apps/web Stripe rail → gate G4 (forward leg) — code ✅
- [x] Server route [`POST /api/checkout/session`](./apps/web/src/app/(frontend)/api/checkout/session/route.ts)
      — Better-Auth session → user, plan-key → stripe_price_env → price id, get-or-create
      `stripe_customers` row BEFORE redirect (I1), then raw `fetch` POST to
      `/v1/checkout/sessions`. No Stripe SDK; matches the edge-fn pattern.
- [x] Identity helper [`verifyAppUser`](./apps/web/src/lib/verifyAppUser.ts) — resolves
      session → `public.users.id + email` (not member id; mixing them would be an I1
      violation).
- [x] Webhook fn from D2 unchanged; same `STRIPE_WEBHOOK_SECRET` and dedup table service
      both rails — no per-rail divergence.
- [x] Web entitlement read already exists: [`useEntitlements`](./packages/app/lib/subscription/use-entitlements.ts)
      (TanStack Query + Supabase, Zustand-backed auth). Reused as-is.
- [x] **No RevenueCat imports anywhere under `apps/web`** — verified by grep.
- [x] Env hygiene (I6): `STRIPE_SECRET_KEY` read only in the route handler
      (`runtime = 'nodejs'`), never imported into a client component.
- [x] `npx tsc --noEmit` clean.
- [ ] Pricing UI page that POSTs to the route (separate task; UI concern).
- [ ] Stripe Dashboard config: `STRIPE_WEBHOOK_SECRET` set + endpoint pointed at the
      Supabase edge fn URL.

## D4 — Mobile rail audit → gate G5
- [ ] Install `react-native-purchases` in `apps/mobile` (post-D2).
- [ ] RevenueCat webhook → same `subscriptions` table, same row shape.
- [ ] Native entitlement read goes through Supabase, not `Purchases.getCustomerInfo()`.
- [ ] Lock identity: `Purchases.logIn(user.id)` so `rc_app_user_id === user.id`, OR
      explicit bridge row created at sign-in. Pick ONE and document the choice.

## D5 — PWA shell (C2) — code ✅
- [x] [`app/manifest.ts`](./apps/web/src/app/manifest.ts) — Next typed manifest, served
      at `/manifest.webmanifest`. Icons fall back to email glyph; proper 192/512
      maskable assets flagged below.
- [x] [`public/sw.js`](./apps/web/public/sw.js) — minimum service worker (install /
      activate / push / notificationclick). Pass-through fetch; precache deferred until
      the funnel is verified end-to-end on a real iOS device.
- [x] [`pwa-store.ts`](./apps/web/src/components/pwa/pwa-store.ts) — Zustand store:
      platform (`ios`/`android`/`other`), `isStandalone`, captured
      `beforeinstallprompt` event, `promptInstall()`.
- [x] [`register-sw.tsx`](./apps/web/src/components/pwa/register-sw.tsx) — mounts the
      SW in prod, hydrates the store. Wired in `(frontend)/layout.tsx`.
- [x] [`install-funnel.tsx`](./apps/web/src/components/pwa/install-funnel.tsx) —
      platform branch. Android = native prompt button. iOS = guided Share→Add overlay.
      Already-installed = renders null.
- [x] [`use-web-push.ts`](./apps/web/src/components/pwa/use-web-push.ts) — Web Push
      subscribe hook. iOS gate: `canSubscribe = false` when not `display-mode: standalone`.
- [x] Apple meta tags + manifest link in [`(frontend)/layout.tsx`](./apps/web/src/app/(frontend)/layout.tsx).
- [x] `npx tsc --noEmit` clean.
- [ ] Proper 192×192 + 512×512 maskable PNG icons at `/icons/pwa-*.png`.
- [ ] Server route to receive `PushSubscription` payloads (lands with D6 token sync).
- [ ] Lynk-entry route that orchestrates the funnel: gate first session on
      `isStandalone && canSubscribe && verified`.

## D6 — Verification (C3) — code (v0) ✅ / Persona REST upgrade pending
- [x] Provider: **Persona** (passive liveness). Schema is provider-neutral so a
      Veriff/Onfido/Yoti swap is one webhook fn + a `provider` enum value.
- [x] Migration [`20260630130000_identity_verifications.sql`](./apps/mobile/supabase/migrations/20260630130000_identity_verifications.sql)
      — `identity_verifications` table, `is_verified(uid)` RPC,
      `upsert_identity_verification(...)` monotonic-guard helper,
      `verification_events` dedup table.
- [x] Start route [`POST /api/verification/start`](./apps/web/src/app/(frontend)/api/verification/start/route.ts)
      — pre-creates the row (I1) then returns the Persona Hosted Flow URL with
      `inquiry-template-id` + `reference-id`. Generic-template v0 path (no
      server-side Inquiry create).
- [x] Webhook fn [`persona-webhook`](./apps/mobile/supabase/functions/persona-webhook/index.ts)
      — Persona-Signature verify, `verification_events` dedup, refuses missing
      `reference-id`, reuses the monotonic upsert pattern.
- [x] Client hook [`useVerification`](./apps/web/src/components/verification/use-verification.ts)
      — TanStack Query read against Supabase + `startVerification()` action.
- [x] `npx tsc --noEmit` clean.
- [ ] **PERSONA-VERIFY:** confirm signature scheme (header name + HMAC over raw
      body), event-type names (`inquiry.approved` etc.), webhook payload field paths
      vs. authoritative Persona docs before going live. All call sites marked
      `PERSONA-VERIFY:` in `persona-webhook/index.ts`.
- [ ] **Upgrade hosted-flow path** — generic template-id link does client-side
      inquiry creation (duplicate inquiries on reload, dedup'd at webhook time).
      Move to server-side `POST /api/v1/inquiries` once REST shape verified.
- [ ] Sequence (install → verification → first Lynk session) — caller composes
      `usePwaStore.isStandalone` + `useVerification.isVerified` at the Lynk-entry
      route. Route itself is D5/D7 territory.
- [ ] iOS edge case fallback to Safari proper if installed-PWA camera permission
      breaks during the Persona flow.

## D7 — Integration matrix — code ✅ / staging checklist pending
- [x] [`entitlement.integration.test.ts`](./apps/mobile/supabase/__tests__/entitlement.integration.test.ts)
      — 8 tests. `node --import tsx --test`, `node:test` only. Skip cleanly without
      `TEST_DATABASE_URL`. Run: 8 skipped in 240ms. Covers:
      - I5 stale-event rejection (web + identity)
      - I5 monotonic forward-move
      - I3 single read path (web_stripe + ios_iap both resolve through `is_entitled`)
      - Dunning grace + canceled-past-period state machine
      - `is_verified` parity for identity
- [x] [`integration-matrix.md`](./doc/integration-matrix.md) — layer-1 SQL CI tests +
      layer-2 manual staging checklist with the exact SQL queries to verify each gate
      (G4, G5, I1, I2, I5).
- [ ] G4 forward staging run: Web Stripe → Supabase → Native entitled (real test card).
- [ ] G5 reverse staging run: Mobile IAP → Supabase → Web entitled.
- [ ] Replay each rail's webhook from the provider dashboard; confirm one row.
- [ ] Anonymous RC `app_user_id` and missing-`reference-id` Persona event return 4xx in
      staging (verified in code; needs a synthetic-event replay to close).
