# Two-Rail Subscriptions — Phase 0 Baseline

**Method:** five parallel read-only audit lanes over `master` (post events+modernization merge, `b7534cc` + the revenuecat.ts restore `4e59732`). **Date:** 2026-08-08. **Status:** Phase 0 — **STOPS for approval** before any feature code, per the prompt's §4.

> ⚠️ **Blocked lane.** The RevenueCat-dashboard catalog audit (live offerings/entitlements/products via the RC AI Toolkit MCP) could not run — the plugin/MCP is not installed in this environment. Everything below is code/config-side truth. **Mike's action:** install the RevenueCat AI Toolkit plugin (OAuth) so the dashboard half of the catalog map and the public SDK keys can be pulled.

> ⚠️ **Regression found & fixed during this audit.** The WS-1 dead-file purge (`185f07d`) deleted `apps/mobile/lib/billing/revenuecat.ts` — a live module lazily `require()`d by string from `auth-store.ts:97,124`, invisible to knip's import graph. Restored byte-identical in `4e59732`. Lesson for future purges: string-form `require()` sites must be grepped, not graphed.

---

## 1 · Purchase-flow inventory (Lane A)

**Verdict: the mobile IAP rail is entirely unimplemented.** `react-native-purchases@^10.7.0` is a dependency (`apps/mobile/package.json:157`) but never imported; zero hits repo-wide for `getOfferings` / `purchasePackage` / `restorePurchases` / `presentPaywall` / `PaywallView`. The restored `lib/billing/revenuecat.ts` is the lifecycle-only wrapper (`configure`/`loginRC`/`logoutRC`, lazy native require, deliberately **no entitlement read** — I3); `auth-store.ts:97` wires `loginRC(user.id)` at sign-in, `:124` `logoutRC()` at logout.

Every current subscribe/manage surface:

| Surface | File | Rail | Reachable? |
|---|---|---|---|
| DVNT Membership paywall (tier ladder, "reader-app pattern" — sells nothing natively, CTA opens web `/pricing`) | `packages/app/features/screens/membership/MembershipScreen.tsx` | none in-app → web | **Web only** (`/settings/membership`); **no native route mounts it** |
| Sneaky Lynk billing (plan card, manage → portal, upgrade → modal; iOS free users get a "visit dvntapp.live" notice per 3.1.1) | `packages/app/features/routes/screens/(protected)/sneaky-lynk/billing.tsx` | Stripe | Native + settings link — reachable |
| Sneaky subscription modal (Free/$15/$25; iOS shows notice, no buy button) | `packages/app/features/sneaky-lynk/components/SneakySubscriptionModal.tsx` | Stripe (`sneaky-billing-checkout`) | Reachable (non-iOS actionable) |
| Sneaky room-access paywall ($2.99 one-time; iOS disabled) | `packages/app/features/sneaky-lynk/components/SneakyPaywallModal.tsx` | Stripe (`sneaky-access-checkout`) | Only if `sneaky_paywall_enabled` flag on (defaults false) |
| Web pricing page (membership + sneaky tiers) | `apps/web/src/components/pricing/pricing-page.tsx` | Stripe (`membership-checkout`) | `/pricing`, linked from header/footer |
| Web sneaky billing | `packages/app/features/sneaky-lynk/screens/billing.web.tsx` | Stripe | `/feed/sneaky-lynk/billing` |

**Entitlement reads today — three divergent paths, and the DB truth is orphaned:**
- **Path A (canonical resolver):** `useEntitlements` (`packages/app/lib/subscription/use-entitlements.ts:79`) reads `membership_subscriptions` + legacy `sneaky_subscriptions` raw and resolves **client-side** (`entitlements.ts:90`). Consumers: `MembershipScreen` and the zero-consumer `useEventAccess`. `canCreateRoom`/`roomDurationLimitSeconds` are defined + tested but never called from app code.
- **Path B (legacy direct):** Sneaky billing + room gating read `sneaky_subscriptions` directly (`room/[id].tsx:713-718,1167-1173`).
- **Path C (orphaned):** `is_entitled()` / `is_entitled_self()` have **no runtime caller anywhere** — only the integration test. The "one entitlement read path" law exists in SQL but no surface uses it.
- I3 violation check: **clean** — no `Purchases.getCustomerInfo()`, no Stripe SDK entitlement reads.

Edge functions (all Stripe-rail; RC is receive-only via its webhook): `sneaky-billing-checkout` (legacy `host_25|host_50`, in-place plan switch w/ proration, creates prices on demand), `sneaky-billing-portal`, `sneaky-access-checkout` ($2.99 payment-mode, webhook-issued access), `membership-checkout` (plan_key rail; supersedes standalone sneaky sub when switching; web-only caller).

## 2 · Plan/catalog map — code side (Lane B)

Canonical value set: `PlanKey = free | sneaky_tier_1 | sneaky_tier_2 | dvnt_core | dvnt_insider | dvnt_vip | dvnt_founders_circle` (`packages/app/lib/subscription/types.ts:18-25`); families `sneaky_lynk | dvnt_membership`. The **legacy** sneaky rail uses a different vocabulary — `plan_id ∈ host_25|host_50` on `sneaky_subscription_plans` — keep them distinct.

**The plan_key ↔ RC ↔ Stripe mapping is fragmented across 7 places:**
1. `packages/app/lib/subscription/plans.ts` — `PLANS`, `PLAN_RANK`, `SUBSCRIPTION_PRICE_ENV`, caps (client canonical)
2. `membership-checkout/index.ts:28-43` — `PRICE_ENV` + `FAMILY`, hand-copied ("mirrors lib/subscription/plans.ts")
3. `video_create_room/index.ts:208-216` — `MEMBERSHIP_MAX_PARTICIPANTS`, hand-copied ("keep in sync")
4. `revenuecat-webhook/index.ts:209,225` — **RC `product_id` used verbatim as `plan_key`** (identity passthrough, zero validation) + hardcoded family. RC dashboard products MUST be named exactly `dvnt_core` etc. or the insert violates the `membership_plans` FK. Implicit and unchecked.
5. `apps/web/.../api/checkout/session/route.ts:120-131` — resolves via DB `membership_plans.stripe_price_env`
6. `membership_plans` DB seed (`20260612044625:20-34`)
7. `stripe-webhook/index.ts:1815-1818` — price↔plan binding authored as checkout-time subscription **metadata**

No literal `price_...` ids or `lookup_key`s exist anywhere — prices resolve by env-var **name** (`STRIPE_PRICE_SNEAKY_TIER_1/2`, `STRIPE_PRICE_DVNT_CORE/INSIDER/VIP/FOUNDERS`) or are created on demand.

**Recommendation (the single canonical module):** `packages/app/lib/subscription/` is already the designated home. Add `revenueCatProductId` per `PlanDef` (kills #4's implicit coupling; export a derived `RC_PRODUCT_TO_PLAN_KEY`), export `PLAN_CAPS` so #2/#3 import instead of re-declaring, and treat the `membership_plans` seed as validated-against-`PLANS` (the integration test already asserts this). Drift between dashboards and code becomes a CI check once the RC MCP is available.

## 3 · Webhook event coverage (Lane C)

### RevenueCat (`revenuecat-webhook/index.ts`, 264 lines)
Solid invariants: constant-time secret auth (I4, :110-141), `rc_events` PK dedup (I2, :158-179), `$RCAnonymousID` refusal (I1, :184-191), non-mobile stores acked/no-op, every write via the guarded upsert (I5, :220-246). Handled: INITIAL_PURCHASE/RENEWAL/UNCANCELLATION/PRODUCT_CHANGE→active, CANCELLATION→active+cancel_at_period_end, EXPIRATION→canceled, BILLING_ISSUE/SUBSCRIPTION_PAUSED→past_due, TEST/NON_RENEWING/TRANSFER→explicit no-op; unknown types ack safely.

**Gaps (vs the full v2 event list, fetched 2026-08-08):**
- **TRANSFER unhandled is a real defect:** the webhook goes to the destination user only; with `ON CONFLICT (user_id)` one-row-per-user, the source user stays `active` forever. Handle: cancel rows for each `transferred_from` id, upsert destination.
- SUBSCRIPTION_PAUSED semantics wrong: Play pause takes effect at period end ("don't revoke here") — current mapping revokes early. Keep active until EXPIRATION, record `auto_resume_at_ms`.
- BILLING_ISSUE never persists `grace_period_expiration_at_ms` (typed at :66, unwritten) — RC rail has no grace horizon while Stripe rail does.
- SUBSCRIPTION_EXTENDED / REFUND_REVERSED unhandled (extension invisible until next RENEWAL; refund-reversal never re-activates). CANCELLATION should branch on `cancel_reason` (refund vs unsubscribe); EXPIRATION should record `expiration_reason`.
- Ignore-with-reason (document only): INVOICE_ISSUANCE, VIRTUAL_CURRENCY_TRANSACTION, EXPERIMENT_ENROLLMENT, PURCHASE_REDEEMED, PAYWALL_*, SUBSCRIBER_ALIAS, PRICE_INCREASE_CONSENT_*; TEMPORARY_ENTITLEMENT_GRANT (log loudly).

### Stripe subscription lane (`stripe-webhook/index.ts`)
Handled: `customer.subscription.created/updated` (metadata-driven guarded upsert + audit rows :1811-1976), `.deleted` (→canceled :1978-2052), `invoice.payment_failed` (→past_due + first-failure grace :2054-2148), `invoice.paid` (**sneaky-only** :2302-2323).

**Gaps:**
- **`invoice.paid` never touches membership rows** — `grace_period_ends_at` is never cleared anywhere on the membership rail; recovery relies solely on the accompanying `.updated` event.
- **`pause_collection` passes through as `active`** (:1838) — paused-collection subscribers stay entitled indefinitely with no invoices. Inspect `sub.pause_collection` in the `.updated` branch.
- `invoice.payment_action_required` unhandled — SCA-blocked renewals ride silently until lapse; treat like `payment_failed` + notify with `hosted_invoice_url`.
- `trial_will_end` unhandled (notification-only opportunity). Schedules/proration/pending_update events: ignore-with-reason (final state arrives via `.updated`).

### Shared I2 weakness (both rails)
Dedup rows are written **before** processing with no completion marker: a transient RPC 500 → provider retry → 23505 → **event permanently swallowed** (the code itself notes this at stripe-webhook:48-50). Fix: `processed_at` column on `stripe_events`/`rc_events`; duplicates skip only fully-processed rows. Also: `sneaky_subscriptions` writes use a weaker inline guard, and `.deleted`/`invoice.paid` sneaky writes have no monotonic guard at all.

## 4 · Cross-rail behavior today (Lane D)

- **Two active rows per user are unrepresentable**: `user_id UNIQUE` (`20260612044625:38`) + `ON CONFLICT (user_id) DO UPDATE`. The "conflict" mode is **silent overwrite**: whichever rail's webhook carries the newer `last_event_at` rewrites the single row **including the `rail` column**. No rail precedence, no alert, no cron, no constraint. (The integration test's "both rails resolve" case uses two different uids — it cannot exercise the collision.)
- `is_entitled()` tiebreak is `current_period_end DESC LIMIT 1` (moot with one row); the client resolver uses a **different** rule (family preference then `PLAN_RANK`) over membership + legacy sneaky rows. Two tiebreak semantics coexist.
- **No cross-rail UI state exists** — the native app sells nothing (reader-app pattern) so there's no paywall to show "subscribed via App Store/web" on. This becomes required work the moment WS-1 ships a native paywall.
- Revocation → enforcement: `video_create_room` reads the table live per-request (immediate on next create) **but checks only `status`, not `current_period_end`** — an `active` row with a lapsed period still grants the cap. `video_join_room` never re-reads: `max_participants` is frozen into the room at creation, so refunds never shrink an existing room. Client `useEntitlements` caches 60 s (display only).

## 5 · Compliance snapshot (Lane E, fetched 2026-08-08)

Guidelines current as of the June 8, 2026 revision (which didn't touch 3.1.x — the operative text is the post-injunction language from May 2025).

- **3.1.1:** in-app digital subscriptions (Sneaky Lynk membership) must use IAP; RevenueCat wraps StoreKit, fine. Embedded Stripe checkout for the membership inside the app remains prohibited — the US allowance is about **linking out**.
- **3.1.1(a) / 3.1.3 — the US carve-out:** on the US storefront, buttons/links/CTAs to web checkout for digital goods are permitted **anywhere in the app, no entitlement required**, and may state that web pricing is lower. Non-US storefronts still need the External Purchase Link Entitlement — **storefront-gate all such copy** or it's a rejection vector (relevant to the 2.1a/2.3.6/3.1.1 history).
- **Tickets: confirmed non-IAP is *required*, not just allowed** — the rule now lives at **3.1.3(e)** ("goods or services consumed outside the app… must use purchase methods other than in-app purchase"). Note: current 3.1.5 is Cryptocurrencies — internal docs citing "3.1.5" for tickets should say 3.1.3(e).
- **External-link commission, current state:** Apple collects **0%** on US externally-linked purchases today — but it is not settled law. Ninth Circuit affirmed the contempt finding (Dec 11 2025) yet held permanent-zero-commission overbroad and remanded; SCOTUS granted cert on the contempt question (Jun 30 2026, decision possibly mid-2027); Apple has a proposed fee pending in the remand. **Treat the external-link commission as a variable, not a constant.**
- **Fee math** (US domestic card): net of $9.99/mo = $8.49 under IAP small-business 15%, $6.99 under IAP 30%, **$9.40** under external link + Stripe (2.9%+30¢). External link beats 15% IAP above $2.48/mo. If the remand lands Apple's old 27% on linked purchases, external-link drops below standard IAP — the architecture must tolerate either outcome. Not in the Stripe column: Stripe Billing add-on fees, dispute fees, sales-tax burden (Apple is merchant of record under IAP; DVNT is under Stripe).
- Caveats the lane could not verify from primary sources: no affirmative Apple statement of "0%" (inferred from current guideline text + removed entitlement page + standing injunction); court milestones verified via reputable coverage, not the PDFs.

**The adopt/don't-adopt call on external purchase links is Mike's** — the facts above are the inputs.

## 5b · Incident addendum (2026-08-08, discovered during Phase 0)

- **`revenuecat-webhook` has `verify_jwt = true` in prod** (pre-existing, not from today's deploys). RevenueCat posts `Authorization: Bearer <webhook secret>` — not a Supabase JWT — so the gateway may be rejecting RC events before the function's own auth runs. Since no RC purchases exist yet (no mobile paywall), nothing has been lost, but **this must be flipped (config.toml pin + redeploy) before any WS-1 sandbox testing**, or every test purchase will silently vanish at the gateway. Same class of bug as today's verify_jwt outage.
- `lib/billing/revenuecat.ts` was deleted by the WS-1 modernization purge (knip can't see string-form `require()`) and restored in `4e59732`. CI idea: a grep-based check that every `require("...")` string literal resolves.

## 6 · Phase-0 decisions & asks (the approval gate)

**Mike's actions before WS-1 execution:**
1. Install the **RevenueCat AI Toolkit plugin** (MCP OAuth) — unblocks the dashboard catalog map, SDK keys, and the skill-driven WS-1 sequence.
2. Approve the **canonical plan-map consolidation** into `packages/app/lib/subscription/` (§2) — prerequisite for the RC product-id ↔ plan_key contract.
3. Decide the **both-rails-active resolution policy** (§4): recommendation is keep one-row-per-user + add a Sentry alert when an upsert flips `rail` on a currently-active row, and show already-subscribed-elsewhere states in UI (WS-3).
4. Read §5 when it lands and make the external-purchase-link call.

**Agent-autonomous scope once approved:** WS-4 webhook fixes are shovel-ready from §3 (TRANSFER, processed_at marker, invoice.paid membership recovery, pause_collection, payment_action_required, RC grace persistence) — each with replay tests per I2/I5. WS-1 paywall work additionally needs the RC plugin + dashboard catalog.

---

## 7 · RC-dashboard catalog lane (unblocked & executed 2026-08-08)

The RevenueCat MCP is live. The dashboard was **empty** (project `proj2d562840` "DVNT", one auto-created Test Store app). The catalog was built via MCP to match the code's plan keys:

| Object | Value |
|---|---|
| Apps | `appbcb533145a` DVNT iOS (`com.dvnt.app`) · `app4d0e345777` DVNT Android (`com.dvnt.app`) · `appc63d7dd1e2` Test Store |
| Products (iOS + Test) | store identifiers **exactly** `dvnt_core`, `dvnt_insider`, `dvnt_vip`, `dvnt_founders_circle` |
| Products (Play) | `dvnt_core:monthly`, `dvnt_insider:monthly`, `dvnt_vip:monthly`, `dvnt_founders_circle:monthly` — Google mandates `subscriptionId:basePlanId` |
| Entitlement | `dvnt_membership` — attached to all 12 products |
| Offering | `default` (current), packages `core` / `insider` / `vip` / `founders_circle`, each carrying its iOS+Play+Test products |
| SDK keys | in `apps/mobile/.env` as `EXPO_PUBLIC_REVENUECAT_IOS_KEY` / `_ANDROID_KEY` (public keys, client-safe) |

**Finding that upgraded §2's recommendation to a defect:** Play's mandatory `subscriptionId:basePlanId` identifier means the RC webhook's `product_id` arrives as `dvnt_core:monthly` on Android — the identity-passthrough at `revenuecat-webhook/index.ts` would violate the `membership_plans` FK on every Android purchase. The `RC_PRODUCT_TO_PLAN_KEY` mapping (with `:basePlanId` normalization) is therefore required for correctness, not hygiene.

**Left for Mike (dashboard, not MCP-able):**
1. App Store Connect API key + in-app-purchase key on the iOS app (`app_store_connect_api_key_configured: false`), and Play service-account credentials on the Android app — required before store sync / production events.
2. Test Store product price points (the v2 price-point API rejected all documented payload shapes; 30-second dashboard task). UI prices render from `plans.ts` regardless.
3. Create the matching IAPs in App Store Connect (`dvnt_core` … at $25/$50/$75/$150 monthly) and the Play subscriptions (`dvnt_core` + base plan `monthly`, …) once store credentials are wired.
