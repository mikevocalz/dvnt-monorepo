# DVNT Payments UI & Settings Suite — Audit

## Existing Infrastructure (Pre-Build)

### Edge Functions

| Function             | Purpose                                             | Status  |
| -------------------- | --------------------------------------------------- | ------- |
| `ticket-checkout`    | Stripe Checkout for ticket purchases                | ✅ Live |
| `stripe-webhook`     | Central webhook: checkout, refund, dispute, account | ✅ Live |
| `promotion-checkout` | Stripe Checkout for event promotions                | ✅ Live |
| `promotion-webhook`  | Activation on promotion payment                     | ✅ Live |
| `organizer-connect`  | Stripe Connect Express onboarding + status          | ✅ Live |
| `payouts-release`    | Cron: release payouts to organizer banks            | ✅ Live |
| `ticket-scan`        | QR validation + check-in                            | ✅ Live |

### DB Tables (Pre-Existing)

| Table                       | Purpose                                        |
| --------------------------- | ---------------------------------------------- |
| `tickets`                   | Purchased tickets with QR, Stripe refs, status |
| `ticket_types`              | Multi-tier ticket types per event              |
| `event_financials`          | Materialized financial snapshot per event      |
| `organizer_accounts`        | Stripe Connect account status                  |
| `payouts`                   | Payout records per event                       |
| `stripe_events`             | Webhook idempotency tracking                   |
| `sneaky_access`             | Sneaky link paywall access                     |
| `event_spotlight_campaigns` | Promotion campaigns                            |

### Pre-Existing UI Screens

| Screen          | Route                    | Purpose                                     |
| --------------- | ------------------------ | ------------------------------------------- |
| View Ticket     | `ticket/[id]`            | QR code, hero card, access details, actions |
| My Tickets      | `events/my-tickets`      | List of user's purchased tickets            |
| Organizer Setup | `events/organizer-setup` | Stripe Connect onboarding                   |
| Event Organizer | `events/[id]/organizer`  | Ticket list, scanner, offline check-in      |
| QR Scanner      | `events/[id]/scanner`    | QR code scanning for check-in               |

---

## New Infrastructure (This Build)

### New DB Tables (Migration: `20260302_payments_ui_tables.sql`)

| Table                | Purpose                                             |
| -------------------- | --------------------------------------------------- |
| `orders`             | Unified purchase record across ticket/promo/sneaky  |
| `order_timeline`     | Timeline events per order (created → paid → refund) |
| `refund_requests`    | User-submitted refund requests with status          |
| `organizer_branding` | Logo + display name for receipts/invoices           |
| `stripe_customers`   | DVNT user → Stripe customer mapping                 |

### New Package

- `expo-print@55.0.6` — AirPrint / Android print dialog + PDF generation

### New Files Created

#### Data Layer

| File                           | Purpose                                                                                                                           |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| `lib/types/payments.ts`        | All payment type definitions, status configs, enums                                                                               |
| `lib/api/payments.ts`          | Client API for all payment screens (methods, purchases, receipts, refunds, host payouts, transactions, disputes, branding, print) |
| `lib/stores/payments-store.ts` | Zustand store for all payment screen state                                                                                        |

#### Print & Templates

| File                             | Purpose                                                                             |
| -------------------------------- | ----------------------------------------------------------------------------------- |
| `lib/print/print-utils.ts`       | expo-print + expo-sharing wrappers (print HTML, print PDF URL, generate PDF, share) |
| `lib/print/thermal-templates.ts` | HTML templates for 58mm/80mm thermal printers + standard PDF receipt                |

#### Attendee Payment Screens

| File                               | Route                                   | Purpose                                                          |
| ---------------------------------- | --------------------------------------- | ---------------------------------------------------------------- |
| `app/settings/payments.tsx`        | `/settings/payments`                    | Hub: methods, purchases, receipts, refunds                       |
| `app/settings/payment-methods.tsx` | `/settings/payment-methods`             | List/add/remove/set-default cards                                |
| `app/settings/purchases.tsx`       | `/settings/purchases`                   | Order history with status chips                                  |
| `app/settings/order/[id].tsx`      | `/settings/order/:id`                   | Full order detail: fees, timeline, tickets, print, share, refund |
| `app/settings/receipts.tsx`        | `/settings/receipts`                    | Receipt list with inline print/share                             |
| `app/settings/receipt-viewer.tsx`  | `/settings/receipt-viewer?orderId&type` | WebView PDF viewer with print + share                            |
| `app/settings/refunds.tsx`         | `/settings/refunds`                     | Refund request list with status tracking                         |
| `app/settings/refund-request.tsx`  | `/settings/refund-request?orderId`      | Refund request form (reason + notes)                             |

#### Host Payment Screens

| File                                 | Route                         | Purpose                                                      |
| ------------------------------------ | ----------------------------- | ------------------------------------------------------------ |
| `app/settings/host-payments.tsx`     | `/settings/host-payments`     | Hub: balance overview, connect status, nav                   |
| `app/settings/host-payouts.tsx`      | `/settings/host-payouts`      | Payout history with gross/net/fee breakdown                  |
| `app/settings/host-transactions.tsx` | `/settings/host-transactions` | Full ledger with type filters                                |
| `app/settings/host-disputes.tsx`     | `/settings/host-disputes`     | Disputes with action-required badges                         |
| `app/settings/host-branding.tsx`     | `/settings/host-branding`     | Logo upload (color + mono), display name, thermal guidelines |

#### Settings Wiring

- `app/settings.ios.tsx` — Added Payments section with "Payments" + "Organizer Payments"
- `app/settings.android.tsx` — Same additions for Android

---

## Screen Features Matrix

| Feature                                             | Implemented                |
| --------------------------------------------------- | -------------------------- |
| Loading state (skeleton/spinner)                    | ✅ All screens             |
| Empty state (icon + message + CTA)                  | ✅ All screens             |
| Error state (retry button)                          | ✅ Key screens             |
| Pull-to-refresh                                     | ✅ List screens            |
| Payment status chips (color-coded)                  | ✅                         |
| Order timeline (created → paid → refund)            | ✅ Order detail            |
| Fee breakdown (subtotal, platform, processing, tax) | ✅ Order detail            |
| Receipt PDF viewer (WebView, pinch zoom)            | ✅ receipt-viewer          |
| Print (AirPrint / Android)                          | ✅ Order detail + receipts |
| Share (PDF via share sheet)                         | ✅ Order detail + receipts |
| Thermal receipt template (58mm + 80mm)              | ✅ thermal-templates       |
| Standard PDF receipt (A4/Letter)                    | ✅ thermal-templates       |
| Deep links to events                                | ✅ Order detail            |
| Deep links to tickets                               | ✅ Order detail            |
| Refund request flow                                 | ✅ refund-request          |
| Host balance overview                               | ✅ host-payments           |
| Host payout history                                 | ✅ host-payouts            |
| Host transaction ledger with filters                | ✅ host-transactions       |
| Host disputes with deadlines                        | ✅ host-disputes           |
| Branding logo upload (color + mono)                 | ✅ host-branding           |
| Thermal printer guidelines                          | ✅ host-branding           |

---

## Edge Functions — ALL IMPLEMENTED

| Function            | File                                            | Actions                                                                         | Auth                      |
| ------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------- | ------------------------- |
| `payment-methods`   | `supabase/functions/payment-methods/index.ts`   | list, setup, set_default, remove                                                | Session verified          |
| `purchases`         | `supabase/functions/purchases/index.ts`         | list, detail, receipt, invoice, refund_request, refunds, disputes, ticket_print | Session verified          |
| `host-payouts`      | `supabase/functions/host-payouts/index.ts`      | summary, list, detail                                                           | Session + organizer check |
| `host-transactions` | `supabase/functions/host-transactions/index.ts` | list (with type filter)                                                         | Session + organizer check |
| `host-disputes`     | `supabase/functions/host-disputes/index.ts`     | list                                                                            | Session + organizer check |
| `branding`          | `supabase/functions/branding/index.ts`          | get, update                                                                     | Session verified          |

### Shared Helpers

| File                        | Purpose                                                                       |
| --------------------------- | ----------------------------------------------------------------------------- |
| `_shared/verify-session.ts` | Session verification via DB lookup, CORS headers, JSON/error response helpers |
| `_shared/resolve-user.ts`   | Resolve Better Auth user → app users row (pre-existing)                       |
| `_shared/business-days.ts`  | Payout release date computation (pre-existing)                                |

### Updated Existing Edge Functions

| Function          | Changes                                                                                                                                                                                                                                     |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ticket-checkout` | Now creates `orders` row (payment_pending for paid, paid for free) + `order_timeline` events                                                                                                                                                |
| `stripe-webhook`  | Now updates `orders` status on checkout.completed, charge.refunded, dispute.created; writes `order_timeline` events; fetches payment method brand/last4 from Stripe; creates order for sneaky_access; auto-resolves pending refund_requests |

The client API layer (`lib/api/payments.ts`) is fully wired to call all functions. **The full stack is complete end-to-end.**

---

## Thermal Receipt Printer Compliance

| Rule                             | Status                             |
| -------------------------------- | ---------------------------------- |
| 58mm (384px) template            | ✅ `receiptThermal58()`            |
| 80mm (576px) template            | ✅ `receiptThermal80()`            |
| High contrast monochrome         | ✅ Black on white, Courier New     |
| QR code centered with quiet zone | ✅ 8px padding, max 200px          |
| No heavy images                  | ✅ Logo optional, grayscale filter |
| Monochrome logo fallback         | ✅ Falls back to display name text |
| Safe margins (12px)              | ✅ body padding: 12px              |
| Cut line markers                 | ✅ `✂ - - -` footer                |
| Large legible font               | ✅ 13px base, 16px headings        |

---

## Architecture Notes

- **No useState** — All screen state uses `usePaymentsStore` (Zustand)
- **No StyleSheet.create** in new screens — NativeWind className only
- **Lucide icons** exclusively
- **expo-image** for all Image rendering (host-branding)
- **expo-file-system/legacy** import path (SDK 55 compat)
- **Reanimated FadeInDown** for staggered card animations
- **LegendList** for virtualized lists (same as my-tickets)
- **FeatureGate** not used on payment screens (payments are core, not feature-flagged)
