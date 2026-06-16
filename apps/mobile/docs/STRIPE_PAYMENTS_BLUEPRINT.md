# DVNT Stripe Payments Architecture — Complete Implementation Blueprint

**Author:** Chief Architect / Principal Product Designer / Security Lead  
**Date:** March 13, 2026 | **Stripe API:** `2026-02-25.clover`

---

## 1. Executive Summary

### Current State — DVNT Has a Mature Stripe Integration

| Area | Status | Maturity |
|------|--------|----------|
| Event Ticketing (free + paid) | ✅ | High |
| Stripe Connect Express (organizer onboarding) | ✅ | High |
| Native PaymentSheet (in-app) | ✅ | High |
| Stripe Checkout Sessions (web fallback) | ✅ | High |
| Fee Calculator (v1_250_1pt) | ✅ | High |
| Webhook Handler (idempotent, deduped) | ✅ | High |
| HMAC-signed QR Tickets + Scan/Check-in | ✅ | High |
| Sneaky Lynk Subscriptions (Stripe Billing) | ✅ | Medium |
| Sneaky Lynk One-time Access ($2.99) | ✅ | Medium |
| Event Promotions (spotlight) | ✅ | Medium |
| Payout Release (cron, 5 biz days) | ✅ | Medium |
| Payment Methods CRUD | ✅ | High |
| Orders System + Timeline | ✅ | High |
| Apple/Google Wallet Passes | ✅ | Medium |
| Payments UI Suite (13 screens) | ✅ | High |
| Refund Requests + Host Disputes | ✅ | Medium |
| Inventory Holds (10-min TTL) | ✅ | High |

### Gap Analysis — What's Missing

| Gap | Priority | Effort |
|-----|----------|--------|
| **Auth on payment edge functions** (SECURITY) | **P0** | Low |
| Apple Pay / Google Pay config verification | P0 | Low |
| Promo codes / discount coupons | P1 | Medium |
| Ticket transfers between users | P1 | Medium |
| Subscription grace period enforcement | P1 | Low |
| Stripe Radar (fraud rules) | P1 | Low (config) |
| Missing webhook events (dispute.closed, invoice.paid, etc.) | P1 | Medium |
| Admin dashboard / operational tooling | P1 | High |
| Webhook delivery logging | P1 | Medium |
| Tax collection (Stripe Tax) | P1 | Medium |
| Subscription proration (upgrade/downgrade) | P1 | Medium |
| Instant payouts for organizers | P2 | Low |
| Ticket self-service cancellation | P2 | Medium |
| Multi-item cart / bundled checkout | P2 | High |
| Merchandise / digital goods | P2 | High |
| Offline check-in sync | P2 | Medium |
| Stripe Identity (KYC) | P2 | Medium |
| Multi-currency | P3 | Medium |

**Key Recommendation:** No architectural rewrites needed. Focus on security hardening (P0), edge case coverage, and feature additions.

---

## 2. Recommended Stripe Product Stack

### Currently Used (Correct)
- **Connect Express** — Organizer payouts (destination charges)
- **Checkout Sessions** — Web redirect + subscriptions
- **PaymentIntents + PaymentSheet** — Native in-app payments
- **Billing** — Sneaky Lynk subscriptions
- **Billing Portal** — Self-service subscription management
- **SetupIntents** — Saved payment methods
- **Customers** — User identity mapping
- **Webhooks** — Event-driven processing (manual HMAC verification)

### To Add
- **Stripe Tax** (P1) — `automatic_tax` on Checkout Sessions
- **Stripe Radar** (P1) — Enable in Dashboard, configure rules
- **Coupons/Promotion Codes** (P1) — Promo codes for tickets/subs
- **Stripe Identity** (P2) — KYC for high-risk organizers
- **Stripe Sigma** (P2) — Financial reporting

### Evaluated and Rejected
- **Connect Custom** — Overkill; Express sufficient, less liability
- **Connect Standard** — Insufficient payout timing control
- **Terminal/Issuing/Treasury** — No use case

---

## 3. Architecture Decisions

### 3.1 Account Model: Platform + Connect Express (Destination Charges) ✅

```
User (Customer) → pays → DVNT Platform Account
                              ├── application_fee_amount (DVNT keeps)
                              └── transfer_data[destination] → Organizer (Express)
```

Correct as-is. Destination charges = single PI, automatic fee extraction, simple refunds.

### 3.2 Payment Flows: Dual (PaymentSheet + Checkout Sessions) ✅

- **PaymentSheet** — Primary (mobile), best UX, Apple/Google Pay native
- **Checkout Sessions** — Subscriptions (required by Billing), web fallback

### 3.3 Fee Model: `v1_250_1pt` ✅

```
Buyer:      2.5% + $1/ticket (added on top)
Organizer:  2.5% + $1/ticket (deducted from payout)
DVNT total: 5%   + $2/ticket
Invariant:  customer_charge == organizer_transfer + application_fee
```

Well-designed with separate rounding, invariant assertion, policy versioning. **Add:** minimum ticket price guard (`price_cents >= 300`), fee cap for expensive tickets.

### 3.4 Payout Timing: T+5 Business Days ✅

Correct. Protects against post-event disputes. **Add:** extend hold to 30 days if dispute opened within window; tiered holds for trusted organizers.

### 3.5 Idempotency: `stripe_events` Table ✅

Correct pattern. **Add:** TTL cleanup (delete rows > 90 days).

---

## 4. Per-Use-Case Flows

### 4.1 Sneaky Lynk Paywall

**Model: Hybrid (monthly subscriptions + one-time access) ✅ — Correct choice.**

| Plans | Price | Limits |
|-------|-------|--------|
| Free | $0 | 5 participants, 5 min |
| Host 25 | $14.99/mo | 25 participants, unlimited |
| Host 50 | $24.99/mo | 50 participants, unlimited |
| One-time access | $2.99 | Per-session unlock |

**Gaps to close:**

**G1: Grace Period** — When `invoice.payment_failed` fires, set `grace_period_ends_at = now() + 7 days`. Client enforces free limits after grace expires. Add column: `ALTER TABLE sneaky_subscriptions ADD COLUMN grace_period_ends_at timestamptz;`

**G2: Proration** — Add `change_plan` action to sneaky-billing-checkout using `stripe.subscriptions.update()` with `proration_behavior: 'create_prorations'`.

**G3: Real-time Sync** — Subscribe to `sneaky_subscriptions` table changes via Supabase Realtime for instant in-app updates.

**Cancel behavior is correct** — `cancel_at_period_end: true` via Billing Portal, access until period end.

### 4.2 Event Ticketing

**Fully implemented.** Both free and paid flows, dual checkout (PaymentSheet + Checkout Sessions), HMAC QR, scan/check-in, inventory holds.

**Gaps to close:**

**G4: Ticket Transfers** — New `ticket_transfers` table + `ticket-transfer` edge function. Rules: only active tickets, status → `transfer_pending`, new QR on completion, max 1 transfer per ticket, organizer can disable per ticket_type.

**G5: Promo Codes** — New `promo_codes` + `promo_code_uses` tables. Validate in create-payment-intent, apply discount before fee calculation, sync with Stripe Coupons.

**G6: Self-Service Cancellation** — Add `refund_policy` column to ticket_types (`no_refunds`, `full_until_24h`, `full_until_48h`, etc.). New `ticket-cancel` edge function checks policy + time to event.

**G7: Atomic Inventory** — Replace SELECT+UPDATE with Postgres `FOR UPDATE` lock or RPC function to prevent TOCTOU race under high concurrency.

### 4.3 Organizer Payouts

**Well implemented.** Express onboarding, destination charges, cron-based release, email statements.

**Gaps to close:**

**G8: Instant Payouts** — For trusted organizers (3+ successful events), use `POST /v1/payouts` with `method: instant` on connected account. Add `trust_level` + `instant_payouts_enabled` to organizer_accounts.

**G9: Reserve Handling** — New organizers: 10% reserve held 30 days post-payout. Established (3+ events, 0 disputes): 0% reserve.

**G10: Payout Timeline UI** — Show event end → dispute window → eligible date → status on organizer's event detail.

### 4.4 General Purchases

**Not yet built.** Recommendation: Do NOT build a full e-commerce engine.

- **Event merchandise** — Reuse ticket_types with `item_type: 'merch'`
- **Digital goods** — Reuse sneaky_access pattern (one-time → entitlement)
- **Apple Pay / Google Pay** — Already 95% working via `automatic_payment_methods[enabled]: true`. Just verify `merchantIdentifier` in StripeProvider and Apple Developer Portal config.
- **Saved payment methods** — Already implemented via payment-methods edge function.
- **Multi-item checkout** — Defer to Phase 8. Use Checkout Sessions with multiple `line_items` when needed.

---

## 5. Database Schema Changes Required

See `docs/STRIPE_BLUEPRINT_PART2.md` for full SQL, or summary:

**New tables:** `ticket_transfers`, `promo_codes`, `promo_code_uses`, `webhook_delivery_log`

**Column additions:**
- `sneaky_subscriptions` → `grace_period_ends_at`
- `organizer_accounts` → `instant_payouts_enabled`, `trust_level`, `total_events_paid`, `total_disputes`
- `ticket_types` → `refund_policy`, `item_type`, `transfers_enabled`
- `tickets` → status expanded to include `transfer_pending`, `transferred`
- `orders` → `promo_code_id`, `discount_cents`, expanded type check to include `sneaky_subscription`, `merch`

---

## 6. Webhook Matrix

### Currently Handled ✅
`checkout.session.completed`, `payment_intent.succeeded`, `payment_intent.payment_failed`, `charge.refunded`, `charge.dispute.created`, `account.updated`, `customer.subscription.created/updated/deleted`, `invoice.payment_failed`

### Must Add
| Event | Priority | Action |
|-------|----------|--------|
| `charge.dispute.closed` | P1 | Won → release hold; Lost → forfeit payout |
| `invoice.paid` | P1 | Clear past_due, reset grace_period_ends_at |
| `transfer.reversed` | P1 | Handle payout clawback |
| `payout.failed` | P1 | Alert organizer, hold |
| `radar.early_fraud_warning` | P1 | Flag order, pause delivery |
| `charge.dispute.updated` | P2 | Sync status |
| `payment_method.attached/detached` | P2 | Sync display |
| `customer.subscription.paused` | P2 | Handle pause |
| `transfer.created` | P2 | Confirm payout |

**Config:** Enable "Listen to events on Connected accounts" for Connect events.

---

## 7. CRITICAL: Security + Compliance

### 7.1 ⚠️ AUTH VULNERABILITY — Must Fix Immediately

These edge functions trust `user_id` from the request body WITHOUT session verification:

| Function | Risk |
|----------|------|
| `create-payment-intent` | Attacker creates PIs for other users |
| `ticket-checkout` | Attacker buys tickets as other users |
| `organizer-connect` | Attacker hijacks organizer onboarding |
| `sneaky-billing-checkout` | Attacker subscribes as other users |
| `sneaky-billing-portal` | Attacker accesses other users' billing |

**Fix:** Apply `verifySession()` from `_shared/verify-session.ts` to ALL functions. Use returned `userId` instead of `body.user_id`.

### 7.2 PCI Compliance: SAQ-A ✅
Card data never touches DVNT servers. Maintain by using Stripe SDKs exclusively.

### 7.3 Webhook Security: HMAC verification ✅
5-min tolerance, SHA-256. Add: log signature failures, consider IP allowlisting.

### 7.4 Fraud Prevention
Enable Stripe Radar. Add velocity limits (max 10 purchases/hour/user). Ticket scalping: max 4/user/event ✅, disable transfers for high-demand events.

### 7.5 Env Vars
All required secrets are set. Verify `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY` in client .env. Add `STRIPE_CONNECT_WEBHOOK_SECRET` for Connect events.

---

## 8. UX/UI Flow Recommendations

**Ticket Purchase:** Event Detail → Ticket Type → Quantity → Fee Breakdown → [Promo Code] → PaymentSheet (Apple Pay/Card) → Success + Add to Wallet

**Organizer Payout:** Create Event → Sell Tickets → Event Ends → 5 biz day hold → Payout Released → Email + Dashboard

**Sneaky Subscription:** Create Room → Limit Hit → Modal (Free/Host25/Host50) → Stripe Checkout (web) → Webhook → Active → Room Expands

**Admin Dashboard (New, P1):** Orders List, Order Detail + Refund, Organizer Accounts, Payout Queue, Webhook Log, Revenue Dashboard. Build as web-only admin panel, NOT in RN app.

---

## 9. Edge Cases / Failure Handling

- **Delayed webhook after PaymentSheet success** → Add client-side polling for ticket issuance (1.5s intervals, max 10 attempts)
- **Refund after check-in** → Block (ticket already scanned)
- **Refund after payout** → Platform absorbs cost (reverse transfer)
- **Organizer deletes Stripe account** → Payout fails → hold + alert
- **Subscription payment fails** → Grace period (7 days), Stripe retries, then downgrade
- **Two users buy last ticket** → Inventory holds prevent overselling (needs atomic RPC upgrade)
- **Double-tap purchase** → `isSafeToOperate()` + idempotency key on PI

---

## 10. Testing Strategy

**Unit:** fee-calculator (rounding, invariant), hmac-qr (sign/verify round-trip), business-days (weekends)

**Integration:** Free ticket → scan, Paid ticket → webhook → issue, Refund → webhook → void, Payout cron → transfer, Subscription lifecycle

**Test Cards:** `4242424242424242` (success), `4000000000000002` (decline), `4000002500003155` (3DS), `4000000000000259` (dispute)

**Webhook Testing:** `stripe listen --forward-to localhost:54321/functions/v1/stripe-webhook` + `stripe trigger <event>`

**Load Test:** 1,000 concurrent purchases for 100 tickets → exactly 100 succeed, 0 overselling.

---

## 11. Launch Checklist

### Pre-Launch (Required)
- [ ] Fix auth on all 5 vulnerable edge functions (P0)
- [ ] Enable Stripe Radar + configure rules
- [ ] Verify webhook endpoints (platform + Connect)
- [ ] Verify Apple Pay merchant ID in Apple Dev Portal + Stripe
- [ ] Configure Billing Portal + subscription retry rules
- [ ] All secrets set in production
- [ ] Full purchase flow tested in Stripe test mode
- [ ] Live mode keys rotated (fresh for prod)
- [ ] Fee calculator tested against 1,000 random inputs

### Post-Launch
- [ ] Monitor webhook delivery rate
- [ ] Monitor failed payment rate
- [ ] Verify first payout cycle completes
- [ ] Check for stale `payment_pending` orders > 1 hour
- [ ] Verify Apple Pay / Google Pay appearing on devices

---

## 12. Phased Implementation Roadmap

| Phase | Work | Duration |
|-------|------|----------|
| **1: Security** | Auth on 5 edge functions, Radar, Billing Portal config | 1-2 days |
| **2: Webhook Gaps** | 5 new event handlers + webhook_delivery_log | 1 day |
| **3: Subscription Hardening** | Grace periods, proration, realtime sync | 1-2 days |
| **4: Promo Codes** | Tables, validation logic, checkout UI, Stripe sync | 2-3 days |
| **5: Ticket Transfers** | Table, edge function, initiate/accept UI | 2-3 days |
| **6: Tax + Apple Pay** | Stripe Tax on sessions, verify merchant config | 1 day |
| **7: Admin Dashboard** | Orders, organizers, payouts, webhooks, revenue | 1-2 weeks |
| **8: Advanced** | Instant payouts, merch, offline sync, Identity, multi-currency | Future |

---

## 13. Decision Matrices

### Connect Account Type
| | Express ✅ | Standard | Custom |
|-|-----------|----------|--------|
| Dev effort | 9 | 8 | 2 |
| Payout control | 9 | 4 | 10 |
| Compliance burden | 10 | 10 | 2 |
| **Score** | **8.7** | **6.2** | **6.3** |

### Sneaky Lynk Model
| | Monthly Sub | Per-Session | Metered | Hybrid ✅ |
|-|-------------|-------------|---------|-----------|
| Revenue predictability | 10 | 3 | 6 | 8 |
| User conversion | 6 | 9 | 4 | 9 |
| **Score** | **7.2** | **7.2** | **4.7** | **7.9** |

### Checkout Flow
| | PaymentSheet Only | Checkout Only | Dual ✅ |
|-|-------------------|---------------|---------|
| Mobile UX | 10 | 4 | 10 |
| Subscription support | 0 | 10 | 10 |
| **Score** | **7.4** | **7.7** | **9.0** |

### Payout Timing
| | Immediate | T+2 | T+5 biz ✅ | T+7 |
|-|-----------|------|-----------|------|
| Organizer satisfaction | 10 | 8 | 6 | 4 |
| Fraud protection | 2 | 5 | 8 | 9 |
| **Score** | **3.5** | **5.5** | **7.8** | **8.0** |

---

## Appendix: Edge Functions Inventory

| Function | Auth | Purpose |
|----------|------|---------|
| `create-payment-intent` | ⚠️ None → Fix | Native PaymentSheet PI |
| `ticket-checkout` | ⚠️ None → Fix | Checkout Session for tickets |
| `ticket-scan` | None (QR = auth) | Check-in validation |
| `organizer-connect` | ⚠️ None → Fix | Connect Express onboarding |
| `payment-methods` | ✅ verifySession | PM CRUD |
| `promotion-checkout` | ✅ verifySession | Spotlight purchases |
| `promotion-webhook` | Stripe signature | Promotion activation |
| `sneaky-billing-checkout` | ⚠️ None → Fix | Subscription creation |
| `sneaky-billing-portal` | ⚠️ None → Fix | Billing Portal link |
| `payouts-release` | Cron (no user auth) | Automated payouts |
| `stripe-webhook` | ✅ HMAC signature | All Stripe events |
| `host-payouts` | ✅ verifySession | Payout dashboard data |
| `host-transactions` | ✅ verifySession | Transaction history |
| `host-disputes` | ✅ verifySession | Dispute list |
| `purchases` | ✅ verifySession | Purchase history |
| `branding` | ✅ verifySession | Organizer branding |
| `reconcile-orders` | Cron | Stale order cleanup |
| `ticket_wallet_apple` | Token-based | Apple Wallet pass |
| `ticket_wallet_google` | Token-based | Google Wallet pass |
