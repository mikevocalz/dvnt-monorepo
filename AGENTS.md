# DVNT Web-First Build-Out — Engineering Contract

## Bar
Distinguished payments/identity engineer. Stripe billing team, RevenueCat server, Supabase
RLS, Square/Adyen money state. You are the person paged at 2am when a web subscriber
can't access Lynk on mobile. Build accordingly.

## Stack (do not substitute)
- Web: Next.js App Router (`apps/web`)
- Native: Expo SDK 56 / RN 0.86 (`apps/mobile`) — parallel track, post-approval distribution
- Mono: pnpm + Turbo
- Data: Supabase / Postgres + Deno edge functions
- Client query: TanStack Query (predicate-based propagation)
- Client state: **Zustand only** — no `useState` for app/business state
- Scripts: Bun
- TS: `npx tsc --noEmit` MUST pass. Verified APIs only — read source/docs before generating. No invented methods.

## Architecture — two rails, one entitlement
| Rail   | Processor    | Owns                                   |
|--------|--------------|----------------------------------------|
| Web    | Stripe       | apps/web. **No RevenueCat on web.**    |
| Mobile | RevenueCat ▶ StoreKit IAP | apps/mobile. **RevenueCat owns mobile only.** |

**Single source of truth:** Supabase `subscriptions` table keyed by `user_id`.
`{status, tier, rail, current_period_end, provider_ref}`. Stripe webhook (edge fn) writes
web rows. RevenueCat webhook (edge fn) writes mobile rows. The app — web AND native —
reads entitlement from Supabase, never from the processor directly.

**Supabase project root in this monorepo:** `apps/mobile/supabase/` (`config.toml`,
`migrations/`, `functions/`). All Deno edge functions land there regardless of which
app they serve. Existing payment-related functions to audit before D2/D3:
`stripe-webhook`, `purchases`, `create-payment-intent`, `payment-methods`,
`promotion-webhook`. Shared helpers in `packages/supabase/` and
`packages/functions/src/supabase/`.

`stripe.customer_id` and `revenuecat.app_user_id` MUST both map to the same DVNT `user_id`.

Gated surface: **Lynk Private Rooms / Sneaky Lynk**.

## Invariants (violating any is a defect, not a regression)

| #  | Invariant |
|----|-----------|
| I1 | Every processor id → exactly one DVNT user_id via a row that EXISTS BEFORE the first webhook. Never infer identity. |
| I2 | Webhooks idempotent + fail CLOSED. Unknown status → not entitled. Replay never grants/revokes incorrectly. |
| I3 | Entitlement read from ONE place: Supabase. Never the processor SDK on the client. Both rails resolve to the same `is_entitled()`. |
| I4 | Signature/auth verification on every webhook. No unauthenticated state mutation. |
| I5 | Event ordering: newer state never silently overwritten by a stale replay. |
| I6 | No secret material (service_role, webhook secret, stripe key) reaches a client bundle. Join is server-side. |

## Constraints (gate the build)

- **C1** — Stripe processor risk audit vs DVNT content (sexuality, harm reduction, UGC).
  Written go/no-go in `doc/processor-risk.md`. If Stripe non-compliant: integrate
  adult-friendly fallback (CCBill/Verotel/Segpay) behind a thin processor abstraction.
  Mobile IAP unaffected.
- **C2** — iOS PWA: Web Push + camera + WebRTC require install-to-Home-Screen (iOS 16.4+).
  Onboarding order: install → verification → first Lynk session. Branch by platform:
  Android `beforeinstallprompt`; iOS manual guided Share→Add-to-Home-Screen.
- **C3** — Verification cannot be compromised. Gov ID + selfie + liveness + age.
  Persona or Veriff preferred (passive liveness). Onfido/Yoti acceptable. Read provider
  web SDK before integrating.
- **C4** — Web→mobile entitlement round-trip MUST work. Subscribe on web (Stripe), open
  native, entitled — no second purchase. Verified before shipping either rail. #1 test.

## Deliverables (ordered, each gates the next)
- **D0** Scaffold (this file, `CLAUDE.md`, `TASKS.md`, `config/defaults.json`, `doc/`)
- **D1** `doc/processor-risk.md` — Stripe go/no-go. BLOCKS web payment.
- **D2** `doc/entitlement-model.md` — Supabase schema, both webhooks, identity bridge. BLOCKS both rails.
- **D3** apps/web Stripe rail (Checkout, webhook edge fn, Zustand+TanStack entitlement hook). **No RevenueCat imports on web.**
- **D4** Mobile rail audit: RevenueCat webhook → same table, same shape. Native reads Supabase, not `getCustomerInfo`. Lock identity strategy.
- **D5** PWA shell — manifest, SW, platform-branched install funnel.
- **D6** Browser verification, sequenced post-install on iOS.
- **D7** Integration matrix — C4 round-trip + reverse.

## Gates (fail-fast)
| #  | Pass condition |
|----|----------------|
| G1 | `npx tsc --noEmit` clean |
| G2 | Processor go/no-go signed (D1) |
| G3 | Entitlement model written + both webhooks land normalized rows (D2) |
| G4 | Web Stripe purchase → Supabase row → native reads entitled (C4) |
| G5 | Mobile IAP → Supabase row → web reads entitled (reverse) |
| G6 | iOS install → verification → Lynk session on real device |

## Output discipline
Terse. Deliver the artifact and stop. Distinguished-level = state the trade-off + failure
mode defended against, in one line, then the code. No hedging. No speculative APIs. If a
Stripe/RevenueCat webhook field cannot be verified against the current published API
version: STOP and flag it by name. Read source before generating. `npx tsc --noEmit`
clean is the floor, not the goal.
