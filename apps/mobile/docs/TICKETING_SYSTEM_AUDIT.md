# DVNT Ticketing System — Full Stack Audit & Implementation Plan

## A) EXISTING INFRASTRUCTURE (WHAT'S BUILT)

### DB Tables (Production)
| Table | Status | Notes |
|---|---|---|
| `events` | ✅ | host_id, ticketing_enabled, capacity, visibility, age_restriction, etc. |
| `ticket_types` | ✅ | price_cents, quantity_total, quantity_sold, max_per_user, sale windows |
| `tickets` | ✅ | per attendee, qr_token, status, checked_in_at, event_id, ticket_type_id |
| `orders` | ✅ | user_id, status, totals, stripe refs, payment method info |
| `order_timeline` | ✅ | order lifecycle events |
| `refund_requests` | ✅ | user refund requests with status |
| `organizer_accounts` | ✅ | stripe_account_id, charges_enabled, payouts_enabled |
| `organizer_branding` | ✅ | logos, display name |
| `stripe_customers` | ✅ | user → stripe customer mapping |
| `stripe_events` | ✅ | webhook idempotency |
| `payouts` | ✅ | organizer payouts |
| `event_financials` | ✅ | event financial summary |

### Edge Functions (All Deployed)
| Function | Status | Actions |
|---|---|---|
| `ticket-checkout` | ✅ | Stripe Checkout Sessions + free tickets + order creation |
| `stripe-webhook` | ✅ | checkout.completed, charge.refunded, dispute.created, account.updated |
| `payment-methods` | ✅ | list, setup, set_default, remove |
| `purchases` | ✅ | list, detail, receipt, invoice, refund_request, refunds, disputes |
| `host-payouts` | ✅ | summary, list, detail |
| `host-transactions` | ✅ | list with type filters |
| `host-disputes` | ✅ | list |
| `branding` | ✅ | get, update |
| `organizer-connect` | ✅ | onboarding/status (pre-existing) |
| `_shared/verify-session.ts` | ✅ | Session auth, CORS, JSON helpers |

### Client API Layer
| Module | Status |
|---|---|
| `lib/api/payments.ts` | ✅ 10 API modules |
| `lib/api/tickets.ts` | ✅ Checkout, scanning, offline sync |
| `lib/api/ticket-types.ts` | ✅ CRUD for ticket types |
| `lib/api/events.ts` | ✅ Batch RPC, co-organizer stubs |
| `lib/api/organizer.ts` | ✅ Connect onboarding |

### Stores
| Store | Status |
|---|---|
| `payments-store.ts` | ✅ All payment UI state |
| `ticket-store.ts` | ✅ Ticket state |
| `create-event-store.ts` | ✅ Wizard with tiers + co-organizers |
| `offline-checkin-store.ts` | ✅ MMKV-persisted offline check-in cache |

### UI Screens
| Screen | Status |
|---|---|
| Event detail (tiers, checkout) | ✅ `app/(protected)/events/[id]/index.tsx` |
| Event creation wizard | ✅ `app/(protected)/events/create.tsx` |
| QR Scanner (VisionCamera) | ✅ `app/(protected)/events/[id]/scanner.tsx` |
| Organizer setup | ✅ `app/(protected)/events/organizer-setup.tsx` |
| My Tickets | ✅ `app/(protected)/events/my-tickets.tsx` |
| Ticket detail + QR | ✅ `app/(protected)/ticket/[id].tsx` |
| 13 payment settings screens | ✅ Complete |
| Receipt viewer + printing | ✅ WebView PDF + expo-print |

### Print & Templates
| File | Status |
|---|---|
| `lib/print/print-utils.ts` | ✅ expo-print + expo-sharing |
| `lib/print/thermal-templates.ts` | ✅ 58mm/80mm thermal + standard PDF |

---

## B) GAPS TO FILL

### 1. Native PaymentSheet (HIGH — currently uses browser redirect)
- `@stripe/stripe-react-native@0.57.2` installed but NOT wired
- No `StripeProvider` in root layout
- Need: PaymentIntent edge function, StripeProvider, useTicketCheckout hook
- Keeps users in-app instead of redirecting to Stripe Checkout browser

### 2. Inventory Reservation / Holds (HIGH — race condition)
- No hold/expiry system; just checks availability at checkout time
- Need: `ticket_holds` table, atomic reservation, TTL-based release

### 3. Co-organizer DB + API (MEDIUM — stubs exist)
- Store supports co-organizers in event creation
- API stubs throw "not yet implemented"
- Need: `event_co_organizers` table, CRUD implementation

### 4. HMAC-signed QR Payload (MEDIUM — security)
- Currently QR token is random hex string (no cryptographic verification)
- Need: HMAC signing on ticket creation, fast local verification on scan

### 5. Checkins Audit Table (MEDIUM — observability)
- Scanner works but doesn't record scan events in dedicated table
- Need: `checkins` table for scan event recording with device_id, operator_id

### 6. Reconciliation Job (LOW — safety net)
- No mechanism to reconcile orders vs Stripe
- Need: Edge function to backfill missed webhooks

---

## C) IMPLEMENTATION PHASES

### Phase 1: StripeProvider + Native PaymentSheet
- Wire `StripeProvider` in `app/_layout.tsx`
- New edge function: `create-payment-intent` (PaymentIntent + ephemeral key)
- New hook: `useTicketCheckout` with initPaymentSheet/presentPaymentSheet
- Update event detail screen to use native sheet instead of browser redirect
- **Non-breaking**: Keep Stripe Checkout as fallback

### Phase 2: Inventory Reservation
- New table: `ticket_holds` (user_id, ticket_type_id, quantity, expires_at)
- Update `create-payment-intent` to create hold atomically
- Background cleanup: release expired holds
- **Non-breaking**: Additive table, no schema changes

### Phase 3: Co-organizer Table + API
- New table: `event_co_organizers` (event_id, user_id, role, permissions)
- Implement API stubs in `lib/api/events.ts`
- Add RLS policies (deny-by-default)
- **Non-breaking**: Additive table

### Phase 4: HMAC-signed QR + Checkins Table
- New table: `checkins` (ticket_id, event_id, scanned_by, device_id, result, created_at)
- Add HMAC signing to ticket creation (qr_payload = base64(ticket_id + event_id + nonce + hmac))
- Update scanner verify endpoint to check HMAC first (fast path)
- **Non-breaking**: New column + table, existing qr_token still works

### Phase 5: Migration Package + Reconciliation + Tests
- Produce full PLAN/PROVE/APPLY/VERIFY/ROLLBACK migration package
- Reconciliation edge function
- Test plan + anti-regression gate checklist

---

## D) ASSUMPTIONS
1. Stripe Checkout Sessions continue to work as fallback for PaymentSheet
2. `@stripe/stripe-react-native` plugin is already in `app.config.js` (installed via pnpm)
3. HMAC signing uses a server-side secret stored in env vars (TICKET_HMAC_SECRET)
4. Co-organizer role is view-only by default; host can grant edit permissions
5. Inventory holds expire after 10 minutes (configurable)
6. All new tables use deny-by-default RLS; edge functions use service_role
7. Event cards UI is NOT touched (per hard rule)
