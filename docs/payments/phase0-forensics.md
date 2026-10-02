# Phase 0 Forensics — DVNT Payments v2

Branch: `feat/dvnt-payments-v2-phase0`  
Baseline: `bc00d16e643babd717ebbbd6179aa5fcd27ca7b2`  
Head: `142dfd3b3f840fcf2c0237d8fb64617afce979ef`  
Date: 2026-09-19

---

## 1. Commits since baseline

| SHA | Subject | Classification | Reason |
|---|---|---|---|
| `046c9db` | fix(ticket): the pass screen was blank in production — hooks below an early return | **keep** | Fixes React error #310 by hoisting hook calls above the first early return in `packages/app/features/events/ticket-detail.web.tsx`. The explanation and remediation are correct. |
| `728bf0a` | docs: handoff for the next agent | **keep** | Adds `docs/HANDOFF-2026-09-19.md`. Factual, includes wrong beliefs, and is required context for this work. |
| `142dfd3` | fix(door): the escape hatch reported nothing and had no height | **keep** | Adds `onError` plumbing for the legacy QR scanner and gives the fallback panel a visible `aspect-square` frame in `packages/app/features/events/scanner.web.tsx`, `packages/app/lib/stores/scanner-store.ts`, and `packages/ui/src/media/QrScanner.legacy.web.tsx`. |

No reverts required. No uncommitted changes other than this Phase 0 work.

---

## 2. Baseline findings verification

### 2.1 Discount codes (`?promo=`) and promoter attribution (`?ref=`) are separate systems

**Verified.**

- Promo codes live in `promo_codes` and are read by `ticket-checkout` via `promoResult`.
- Promoter codes live in `event_promoters` and are read via `validPromoterCode` / `dvnt_promoter_code` metadata.
- The tracked promoter link uses `?ref=`:
  - `packages/app/lib/api/promoters.ts:52` → `promoterShareLink()` returns `https://dvntapp.live/public/events/${eventId}?ref=${code}`.
- The native/web promo-codes screens never touch `event_promoters`; the promoters screens never touch `promo_codes`.

### 2.2 Promoter UI defaults to 10% while the API accepts other rates; the earning helper uses organizer net after fees, not ticket subtotal

**Verified.**

- Default percent input is `"10"`:
  - `packages/app/features/routes/screens/(protected)/events/[id]/promoters.tsx:82`
  - `packages/app/features/events/promoters.web.tsx:89`
- `parsePercentToBps` accepts any value 0–100 and stores it as bps.
- Earning basis is organizer net (subtotal − organizer fee):
  - `packages/app/lib/events/event-role.ts` documents capability roles.
  - `packages/app/lib/api/promoters.ts:31-34` shows `grossCents` and `earnedCents` come from the server/ledger.
  - `apps/mobile/supabase/functions/_shared/order-state.ts:60-69` documents the ledger base: `floor(locked_rev_share_bps × organizer_transfer_amount / 10000)`, where `organizer_transfer_amount = subtotal − organizer_fee`.

This is **not** the canonical case required by the new prompt (basis should be eligible ticket subtotal after promoter discount, before organizer fees). ADR-001 / Phase 2 must version the policy and change the basis.

### 2.3 A partial refund reverses the whole promoter earning

**Verified.**

- `apps/mobile/supabase/functions/_shared/order-state.ts:170-174` — `recordPromoterReversal` reverses the full earning amount (`-earning.amount_cents`) keyed only by `order_id`, with no proportion logic keyed by refund id.
- The comment explicitly states: "even a partial refund reverses the entire earning".

### 2.4 Native Staff supports invitations; the native scanner toolbar has Back and Flashlight only

**Partially verified.**

- Web staff management (`packages/app/features/events/staff.web.tsx:49-65`) supports invite with role options `scanner`, `editor`, `admin`.
- Native scanner toolbar was not exhaustively re-verified in this pass; the native route file and `packages/app/features/events/scanner.web.tsx` show camera controls for torch/zoom. The claim is accepted from the handoff.

### 2.5 `event-analytics` allows owner and accepted admin; Staff role copy promises analytics to editors

**Verified.**

- `apps/mobile/supabase/functions/event-analytics/index.ts:64-90` checks `events.host_id === authId` or `event_co_organizers` with `accepted=true` and `role IN ['admin']`. Editors are rejected.
- Web staff management copy at `packages/app/features/events/staff.web.tsx:58` says editor is "Scanner + full roster + refunds + analytics." This over-promises; editors cannot hit `event-analytics`.

### 2.6 Native checkout creates destination charges while `payouts-release` also creates organizer transfers

**Verified.**

Destination charges (all three native/web checkout paths):
- `apps/mobile/supabase/functions/ticket-checkout/index.ts:548-552` uses `payment_intent_data[application_fee_amount]` + `payment_intent_data[transfer_data][destination]`.
- `apps/mobile/supabase/functions/cart-checkout/index.ts:400-401` uses `transfer_data[destination]` + `application_fee_amount`.
- `apps/mobile/supabase/functions/create-payment-intent/index.ts:453-454` uses `transfer_data[destination]` + `application_fee_amount`.

`payouts-release` then creates a second organizer transfer:
- `apps/mobile/supabase/functions/payouts-release/index.ts:447-457` POSTs to `/transfers` with `destination: organizer.stripe_account_id` for `organizerNetCents`.
- No guard was found that skips destination-charged orders.

This is a double-funding hazard for destination-charged historical orders. ADR-001 must decide the model and gate future transfers by order `charge_model`.

### 2.7 `payouts-release` event-level scheduling can strand held promoter earnings once an event is released

**Verified.**

- `apps/mobile/supabase/functions/payouts-release/index.ts:288-294` selects events with `payout_status = 'pending'` and `payout_release_at <= now`, then sets `payout_status = 'released'`.
- `settlePromoters()` only processes rows where `paid_out_at IS NULL`. A promoter who onboards **after** the event is released will still have unpaid earning rows, but the event row is now `released`, so the cron will never select it again.
- Held shares therefore have no retry path independent of event payout state. Phase 3 must repair this.

---

## 3. Gate baseline

`.claude/gate.json` created with real repo commands:

- `typecheck` → `pnpm typecheck`
- `web-typecheck` → `pnpm --filter web typecheck`
- `mobile-typecheck` → `pnpm --filter mobile typecheck`
- `lint` → `pnpm lint` (checkpoint)
- `unit` → `pnpm test` (checkpoint)
- `routes` → `pnpm verify:routes` (checkpoint)
- `issuance` → `pnpm verify:issuance` (checkpoint)

### 3.1 Results

```
PASS  typecheck  (pnpm typecheck)
PASS  web-typecheck  (pnpm --filter web typecheck)
PASS  mobile-typecheck  (pnpm --filter mobile typecheck)
FAIL  lint  (pnpm lint)
PASS  unit  (pnpm test)
PASS  routes  (pnpm verify:routes)
FAIL  issuance  (pnpm verify:issuance)
```

### 3.2 Pre-existing failures (not blocking Phase 0)

**lint:** Multiple packages lack ESLint 9 `eslint.config.(js|mjs|cjs)` files or have misconfigured globs (`@dvnt/utils`, `@dvnt/network`, `@dvnt/supabase`, `@dvnt/auth`, `@dvnt/ui`, `@dvnt/types`, `web-vite`). This is a monorepo-wide config drift, not introduced by this work.

**issuance:** Two categories of pre-existing issues:
1. Upsert `onConflict` targets with no matching unique index:
   - `post-like/index.ts:134` → `notifications`
   - `stripe-webhook/index.ts:1278` → `sneaky_subscriptions`
   - `toggle-follow/index.ts:195` → `follows`
2. 11 tables created in migrations but never granted to `service_role`:
   - `public.rc_events`, `public.identity_verifications`, `public.verification_events`, `public.allowlisted_emails`, `public.onboarding_state`, `public.payload`, `public.web_push_keys`, `public.event_presence`, `public.call_media_leases`, `public.call_media_peers`, `public.verified_admission_policy`.

These match the handoff's open-work item #4 and will be addressed in later phases where they block money, webhooks, or push paths.

---

## 4. Applied migrations snapshot

`.claude/applied-migrations.txt` created from `npx supabase migration list` (202 entries, last 10 shown):

```
20260809110000
20260810221239
20260904193652
20260904193733
20260915140000
20260915172318
20260915190000
20260915200000
20260915210000
20260915220000
```

The `guard-files` hook will now block edits to these already-applied migration files.

---

## 5. Required Phase 0 fixes

### 5.1 `QrScanner` `paused` prop was missing from native type

The `142dfd3` scanner commit added `paused={...}` to the `<QrScanner>` call in `packages/app/features/events/scanner.web.tsx`, but the type exported from `@dvnt/ui` was resolved from the native `QrScanner.tsx` props interface, which did not include `paused`. This made `pnpm typecheck` fail.

Fix applied:
- Added `paused?: boolean` to `packages/ui/src/media/QrScanner.tsx` props.
- Implemented `paused` on native by passing `onBarcodeScanned={undefined}` while paused, matching the web behavior.

This keeps the native/web scanner APIs in sync and unblocks the typecheck gate.

### 5.2 Mobile tsconfig deprecation flag drifted

`apps/mobile/tsconfig.json` had `"ignoreDeprecations": "5.0"`. The monorepo's TypeScript 6 treats `baseUrl` as deprecated and requires `"6.0"` to silence the error. The package-level `mobile-typecheck` uses the workspace TypeScript, so it is fine with `"6.0"`; the handoff recipe `npx tsc -p apps/mobile --noEmit` uses a globally-installed older TypeScript that rejects `"6.0"`. The gate therefore uses the repo's real command (`pnpm --filter mobile typecheck`), and `"ignoreDeprecations": "6.0"` is required for `pnpm typecheck` to pass.

Fix applied:
- Updated `apps/mobile/tsconfig.json` from `"5.0"` to `"6.0"`.
- Updated `.claude/gate.json` to use `pnpm --filter mobile typecheck` instead of `npx tsc -p apps/mobile --noEmit`.

---

## 6. Skills and hooks installed

Copied from `~/Downloads/dvntpayment/dvnt-door-pos-kit.zip` into the repo:

- `.claude/skills/dvnt-money-path/SKILL.md`
- `.claude/skills/dvnt-payments-ux/SKILL.md`
- `.claude/skills/dvnt-payments-ux/references/mobbin.md`
- `.claude/hooks/gate.mjs`, `_lib.mjs`, `guard-bash.mjs`, `slop-scan.mjs`, `guard-files.mjs`
- `.claude/settings.json`

External skills listed in the prompt (`stripe-best-practices`, `connect-recommend`, `supabase`, `better-auth-best-practices`, etc.) are **not yet installed** because the `install-skills.sh` script requires the `claude` CLI and `stripe` CLI, neither of which are available in this Devin Desktop environment. They will be installed or their absence documented before their respective phases.

---

## 7. Gate 0 status

- [x] Forensics file written
- [x] `gate.json` created with real repo commands
- [x] `applied-migrations.txt` created
- [x] Gate runs
- [x] Tree builds (typecheck, web-typecheck, mobile-typecheck, unit, routes pass)
- [ ] Forensics reviewed by Mike (blocking per prompt)

**No reverts requested.** The three commits since baseline are classified **keep**.
