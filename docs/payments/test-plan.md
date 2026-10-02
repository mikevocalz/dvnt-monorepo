# DVNT Payments v2 — Test Plan

Status: Draft — pending ADR approval and Mike sign-off  
Date: 2026-09-19

---

## Layers

| Layer | Tool | When |
|---|---|---|
| Unit | `node --test` packages/app/**/*.test.ts, packages/ui/**/*.test.ts | Every commit (stop gate for money code) |
| Edge-function unit | `deno test` in function directories where `.test.ts` exists | Every function change |
| Integration | `pnpm verify:issuance`, `pnpm verify:functions:live` (sandbox) | Gate checkpoints, before deploy |
| Web typecheck | `pnpm --filter web typecheck` | Stop gate |
| Mobile typecheck | `pnpm --filter mobile typecheck` | Stop gate |
| Routes | `pnpm verify:routes` | Stop gate |
| E2E / UI | Argent MCP tools on iOS simulator / Android emulator / web browser | Phase gates 2–5 |
| Accessibility | `design:accessibility-review` + manual screen-reader checks | Before each screen gate |

---

## Acceptance mapping

### P0 web gate

| # | Acceptance item | Test name | Layer |
|---|---|---|---|
| 1 | Organizer opens event operations on web and manages multiple scanners | `door-organizer-manages-scanners.e2e` | E2E web |
| 2 | Accepted scanner opens event on phone browser and scans without seeing event sales/finance | `door-scanner-financial-isolation.e2e` | E2E web + API response assertions |
| 3 | Scanner enters Sell, picks tier, enters ANDRE, sees 10% off before paying | `door-sell-promoter-discount.e2e` | E2E web |
| 4 | $50 tier + ANDRE charges $45.00; order attributed to Andre, locks $4.50 | `door-sell-andre-canonical-case.unit` + `promoter-attribution-locks-commission.integration` | Unit + Integration |
| 5 | Door sale and online sale race for last ticket with no oversell | `inventory-race-door-vs-online.integration` | Integration (parallel holds) |
| 6 | Guest receives real ticket and receipt; not assigned to scanner | `door-sale-guest-ticket-delivery.e2e` + `sold_by_staff_user_id-not-buyer.unit` | E2E + Unit |
| 7 | `Check in now` writes separate admission record | `check-in-separate-admission-record.unit` + `door-checkin-admission.e2e` | Unit + E2E |
| 8 | Decline, cancel, timeout, retry, paid-but-pending neither double-charge nor duplicate tickets | `payment-failure-no-double-fulfillment.integration` | Integration |
| 9 | Direct API/URL attempts as scanner/promoter return no organizer sales, payouts, aggregates, exports, other promoters' data | `role-based-api-isolation.integration` + `cross-event-role-isolation.unit` | Integration + Unit |

### Full program

| # | Acceptance item | Test name | Layer |
|---|---|---|---|
| 10 | Three scanners invited and accepted; duplicate invites create no duplicate membership; revocation ends later authorized access | `scanner-invite-deduplication.integration` + `scanner-revocation-caches-clear.integration` | Integration |
| 11 | Add scanner reachable from native and web scanner screens in camera-denied and loading states | `door-scanner-add-scanner-from-error-states.e2e` | E2E native + web |
| 12 | Financial isolation holds across UI, URLs, APIs, exports, joins, realtime, cache; cross-event and mixed-role cases pass | `financial-isolation-all-surfaces.e2e` + `realtime-channel-isolation.integration` | E2E + Integration |
| 13 | $50 earns $5.00 without discount; $45 discounted earns $4.50; quantities, rounding, zero-price, add-ons, legacy snapshots reconcile exactly | `promoter-commission-canonical-cases.unit` + `commission-legacy-snapshot-reconciliation.integration` | Unit + Integration |
| 14 | Code and link attribution survive every supported checkout transition; paused/invalid/cross-event/ambiguous discounts never misattribute | `promoter-attribution-checkout-transitions.unit` + `promoter-attribution-invalid-codes.integration` | Unit + Integration |
| 15 | Held earnings settle exactly once after late onboarding | `promoter-held-earnings-late-onboarding.integration` | Integration (sandbox Stripe) |
| 16 | Partial and full refunds, repeat notifications, disputes, negative adjustments, failed transfers, failed bank payouts, post-transfer recovery reconcile without erased debt or over-reversal | `refund-commission-proportionality.unit` + `dispute-transfer-reversal-recovery.integration` | Unit + Integration (sandbox) |
| 17 | No second organizer transfer for destination-funded order; crash and retry at every boundary is safe | `destination-charge-no-second-transfer.unit` + `settlement-crash-recovery.integration` | Unit + Integration (sandbox) |
| 18 | Tap to Pay matrix from Gate 5 | See Gate 5 table below | E2E native (physical devices) |
| 19 | Existing ticket issuance, discounts, guest delivery, QR scanning, add-on redemption, unrelated subscriptions still pass | Regression: `existing-ticket-issuance.integration`, `existing-discounts.unit`, `existing-qr-scanning.e2e` | Unit + Integration + E2E |

### Gate 5 — Tap to Pay

| State / error | Test name | Layer |
|---|---|---|
| Success | `tap-to-pay-success-physical-iphone` / `...-android` | E2E native on physical device |
| Decline | `tap-to-pay-decline-recoverable` | E2E native |
| Cancel | `tap-to-pay-cancel-no-ticket` | E2E native |
| Permission denied | `tap-to-pay-permission-denied-actionable` | E2E native |
| Unsupported device | `tap-to-pay-unsupported-fallback-to-web-sell` | E2E native |
| Expired session | `tap-to-pay-expired-session-no-charge` | E2E native |
| Background mid-payment | `tap-to-pay-background-resume-same-order` | E2E native |
| Timeout after capture | `tap-to-pay-timeout-reconcile-no-double-charge` | E2E native + Integration |
| Retry | `tap-to-pay-retry-after-decline` | E2E native |
| Delayed and duplicate webhooks | `tap-to-pay-duplicate-webhooks-idempotent` | Integration |

---

## Test-first checklist for money code

For every function or rule that touches money, inventory, tickets, roles, RLS, or webhooks:

1. Write the failing unit test asserting exact minor-unit amounts or exact access denial.
2. Show it fails.
3. Implement.
4. Show it passes.
5. Add an integration test against the edge function (sandbox Stripe where possible).
6. Run `node .claude/hooks/gate.mjs --all` before declaring done.

## Notes

- All Stripe assertions use sandbox object ids; no live keys.
- E2E native tests require physical iPhone XS+ and Android 13+ devices; simulators/emulators are insufficient for NFC and camera/Tap to Pay.
- Every new screen follows the UX skill ten-step sequence; accessibility findings are fixed or ticketed before the screen gate.
