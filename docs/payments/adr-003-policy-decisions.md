# ADR-003: Policy decisions for promoter payouts, attribution, and door access

Status: Draft — requires Mike sign-off  
Date: 2026-09-19  
Scope: Commission rules, code stacking, self-referral, held earnings, offline scanner authorization, legacy editor permissions

---

## Context

The payments prompt (Phase 2–4) requires explicit product policy before code is written. This ADR collects the decisions that only the product owner can make, with the current system behavior and a recommendation for each.

## Decisions required

### 1. Commission basis and policy versioning

**Current behavior**
- `recordPromoterEarning` bases commission on the organizer net after DVNT fees (`subtotal − organizer_fee_cents`) <ref_file file="/Users/mikevocalz/dvnt-monorepo/apps/mobile/supabase/functions/_shared/order-state.ts" />, <ref_snippet file="/Users/mikevocalz/dvnt-monorepo/apps/mobile/supabase/functions/_shared/order-state.ts" lines="60-69" />.
- The prompt requires commission on **eligible ticket subtotal after promoter discount, before organizer and processing fees**.

**Recommendation**: adopt the prompt's definition.

- Eligible = ticket subtotal only.
- After promoter discount = `original_subtotal − discount_amount`.
- Before fees = exclude buyer service fees, taxes, donations, add-ons.
- Snapshot on the order: `promoter_policy_version`, `original_amount_cents`, `discount_bps`, `discount_amount_cents`, `discounted_amount_cents`, `promoter_id`, `promoter_code`, `promoter_commission_bps`, `commission_amount_cents`, `rounding_rule`.
- New policy version = `v2_eligible_subtotal_after_discount`.
- Historical rows keep their computed value and version.

**Decision needed from Mike**: confirm the basis and the version name.

### 2. Discount / commission stacking

**Current behavior**
- Promo codes (`?promo=`) and promoter codes (`?ref=`) are separate systems.
- `promo_codes` can be percent or fixed amount.
- There is no documented rule for what happens if both apply.

**Recommendation**

- Promoter discount and other coupon discounts can stack.
- Order of application: promoter discount first, then other coupons, so the commission basis is the post-promoter subtotal.
- Cap: customer discount cannot reduce the ticket subtotal below zero.
- Example: $50 tier, ANDRE 10% off → $45 subtotal, 10% commission on $45 = $4.50.
- If another coupon is present, commission is still on the post-ANDRE amount.

**Decision needed from Mike**: confirm stacking order and whether promoter commission is ever calculated on the fully-discounted (zero) amount.

### 3. Self-referral and duplicate attribution

**Current behavior**
- The only guard appears to be that the promoter code must exist and be active at purchase time; there is no explicit self-referral block.

**Recommendation**

- A promoter cannot earn commission on a ticket they purchase themselves. The buyer's Better Auth identity, if known, must not match the promoter identity.
- For guest checkout, self-referral cannot be blocked deterministically; the order is attributed and commission accrues, but reconciliation may reverse it if a duplicate email or account is detected later.
- Duplicate attribution: the last valid code applied before payment wins. A code typed after a tracked link replaces earlier attribution deterministically.
- Audit data kept: store the raw entry path (`ref` query param, typed code, or direct), the code at time of hold, and the final locked code.

**Decision needed from Mike**: confirm self-referral block scope (authenticated buyers only, or also guest email matching?), and whether guest self-referral is a known acceptable risk.

### 4. Held earnings for unonboarded promoters

**Current behavior**
- `payouts-release` marks unpaid rows as `held` when the promoter has no connected account or transfer fails <ref_file file="/Users/mikevocalz/dvnt-monorepo/apps/mobile/supabase/functions/payouts-release/index.ts" />, <ref_snippet file="/Users/mikevocalz/dvnt-monorepo/apps/mobile/supabase/functions/payouts-release/index.ts" lines="156-178" />.
- Once an event is marked `payout_status = 'released'`, the cron never selects it again, so late-onboarded promoters are stranded.

**Recommendation**

- Held earnings never flow to the organizer and are never dropped.
- Promoter payables retry independently of event payout state.
- Add a separate scheduled job or extend `payouts-release` to process held rows for released events.
- Settlement claims an immutable ledger-row set atomically, then transfers, then records the Transfer id; rows arriving mid-run are not swept in.

**Decision needed from Mike**: confirm the held-earnings policy and acceptable retry cadence.

### 5. Offline scanner authorization window

**Current behavior**
- Door staff role is resolved server-side; the client caches it for 5 minutes <ref_file file="/Users/mikevocalz/dvnt-monorepo/packages/app/lib/hooks/use-event-role.ts" />, <ref_snippet file="/Users/mikevocalz/dvnt-monorepo/packages/app/lib/hooks/use-event-role.ts" lines="20-39" />.
- There is no documented offline scan window.

**Recommendation**

- For the first release, do **not** allow offline scanning. A scan must reach the server for validation and check-in.
- The scanner UI shows an "Offline" state and pauses sales and scanning when no connection is detected.
- This avoids silent acceptance of revoked staff, refunded tickets, or wrong-event codes.

**Decision needed from Mike**: confirm no offline scan window for Phase 4, or define a bounded window (e.g., last server sync within N minutes with a signed token).

### 6. Legacy editor permissions

**Current behavior**
- `event-role.ts` defines `editor` as a role that can edit the event, view full roster, but not manage staff or payouts <ref_file file="/Users/mikevocalz/dvnt-monorepo/packages/app/lib/events/event-role.ts" />, <ref_snippet file="/Users/mikevocalz/dvnt-monorepo/packages/app/lib/events/event-role.ts" lines="18-51" />.
- `event-analytics` only allows owner and `admin`; `editor` is rejected <ref_file file="/Users/mikevocalz/dvnt-monorepo/apps/mobile/supabase/functions/event-analytics/index.ts" />, <ref_snippet file="/Users/mikevocalz/dvnt-monorepo/apps/mobile/supabase/functions/event-analytics/index.ts" lines="64-90" />.
- Web staff management copy promises editors access to analytics, which they do not have <ref_file file="/Users/mikevocalz/dvnt-monorepo/packages/app/features/events/staff.web.tsx" />, <ref_snippet file="/Users/mikevocalz/dvnt-monorepo/packages/app/features/events/staff.web.tsx" lines="49-65" />.

**Recommendation**

- Retain `editor` as "approved non-financial editing only": edit event content/schedule/tiers, view full roster, process refunds (because refunds are an operational correction, not a payout).
- Do **not** grant analytics, staff management, or payout visibility to `editor`.
- Update the web staff role description to match the actual permission.
- Rename label from "Manager" to "Editor" or update copy to "Scanner + full roster + refunds" without analytics.

**Decision needed from Mike**: confirm the reduced `editor` scope and the UI label/copy change.

---

## Blockers

This ADR must be approved before Phase 2 code starts. The open product-policy questions above cannot be resolved by engineering inference.

## References

- DVNT code: `apps/mobile/supabase/functions/_shared/order-state.ts`
- DVNT code: `apps/mobile/supabase/functions/payouts-release/index.ts`
- DVNT code: `apps/mobile/supabase/functions/event-analytics/index.ts`
- DVNT code: `packages/app/lib/events/event-role.ts`
- DVNT code: `packages/app/features/events/staff.web.tsx`
- DVNT code: `packages/app/lib/hooks/use-event-role.ts`
