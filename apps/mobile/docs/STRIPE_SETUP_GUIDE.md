# Stripe Setup Guide — DVNT

Complete guide for configuring Stripe for the Deviant app. Covers all payment flows: event ticketing, Sneaky Lynk paywall, subscriptions, event promotions, organizer payouts, and payment method management.

---

## 1. Create Your Stripe Account

1. Go to [https://dashboard.stripe.com/register](https://dashboard.stripe.com/register)
2. Complete business verification (name, address, bank account)
3. You'll start in **Test Mode** — all setup below can be done in test mode first

---

## 2. API Keys

### Where to find them

**Dashboard → Developers → API keys**

You need **3 keys**:

| Key                        | Example                        | Where it goes                                                                                         |
| -------------------------- | ------------------------------ | ----------------------------------------------------------------------------------------------------- |
| **Publishable key**        | `pk_test_...` or `pk_live_...` | Client `.env` as `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY` AND Supabase secret as `STRIPE_PUBLISHABLE_KEY` |
| **Secret key**             | `sk_test_...` or `sk_live_...` | Supabase secret as `STRIPE_SECRET_KEY` (NEVER in client code)                                         |
| **Webhook signing secret** | `whsec_...`                    | Supabase secret as `STRIPE_WEBHOOK_SECRET`                                                            |

### Set in your local `.env`

```bash
EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...
```

### Set as Supabase secrets

```bash
npx supabase secrets set STRIPE_SECRET_KEY=sk_test_...
npx supabase secrets set STRIPE_PUBLISHABLE_KEY=pk_test_...
npx supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_...
```

> **The publishable key is set in TWO places** — client-side for `StripeProvider` in `app/_layout.tsx`, and as a Supabase secret so the `create-payment-intent` edge function can return it to the PaymentSheet.

---

## 3. Webhooks

You need **2 webhook endpoints** — one for the main payment flows and one for promotions.

### 3a. Main Webhook

**Dashboard → Developers → Webhooks → Add endpoint**

| Field            | Value                                                                  |
| ---------------- | ---------------------------------------------------------------------- |
| **Endpoint URL** | `https://npfjanxturvmjyevoyfo.supabase.co/functions/v1/stripe-webhook` |
| **Description**  | DVNT main webhook — tickets, subscriptions, disputes, payouts          |

**Events to subscribe to (all required):**

#### Checkout & Payments

- `checkout.session.completed` — issues tickets after Checkout Session payment, grants Sneaky Lynk access
- `checkout.session.expired` — releases inventory holds, fails pending orders
- `payment_intent.succeeded` — issues tickets after native PaymentSheet payment
- `payment_intent.payment_failed` — releases holds, marks orders failed

#### Refunds & Disputes

- `charge.refunded` — marks tickets refunded, updates order status (full/partial)
- `charge.dispute.created` — flags event payout on_hold, notifies organizers
- `charge.dispute.closed` — resolves dispute (won/lost), releases payout hold if no more disputes

#### Connect Accounts

- `account.updated` — syncs organizer account status (charges_enabled, payouts_enabled)

#### Transfers & Payouts

- `transfer.reversed` — puts payout back on_hold, notifies organizers
- `payout.failed` — notifies organizers of failed bank payouts

#### Fraud

- `radar.early_fraud_warning.created` — adds fraud warning to order timeline, notifies organizers

#### Subscriptions (Sneaky Lynk)

- `customer.subscription.created` — creates subscription record
- `customer.subscription.updated` — syncs plan changes, status transitions
- `customer.subscription.deleted` — marks subscription canceled
- `invoice.payment_failed` — sets 7-day grace period on subscription
- `invoice.paid` — confirms renewal, clears grace period

**After creating**, copy the **Signing secret** (`whsec_...`) and set it:

```bash
npx supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_...
```

### 3b. Promotion Webhook

**Dashboard → Developers → Webhooks → Add endpoint**

| Field            | Value                                                                     |
| ---------------- | ------------------------------------------------------------------------- |
| **Endpoint URL** | `https://npfjanxturvmjyevoyfo.supabase.co/functions/v1/promotion-webhook` |
| **Description**  | DVNT promotions — event spotlight campaigns                               |

**Events to subscribe to:**

- `checkout.session.completed`

**After creating**, copy the signing secret and set it:

```bash
npx supabase secrets set STRIPE_PROMOTION_WEBHOOK_SECRET=whsec_...
```

---

## 4. Enable Stripe Connect (for Organizer Payouts)

Event organizers receive ticket revenue via **Stripe Connect Express** accounts.

### 4a. Enable Connect

**Dashboard → Settings → Connect → Get started**

1. Choose **Express** account type
2. Fill in your platform profile:
   - **Platform name**: DVNT
   - **Platform URL**: https://dvntapp.live
   - **Industry**: Events / Ticketing
3. Set branding (logo, colors, icon) — this appears on the Express onboarding flow organizers see

### 4b. Connect Settings

**Dashboard → Settings → Connect settings**

- **Account types**: Express
- **Capabilities requested**: `card_payments` + `transfers`
- **Payout schedule**: Set to your preference (the `payouts-release` cron handles DVNT's timing, but Stripe's own schedule applies to the connected account's bank transfers)

### 4c. How it works in the app

1. Organizer taps "Set Up Payments" → `organizer-connect` edge function creates an Express account + returns an onboarding link
2. Organizer completes Stripe's hosted onboarding (ID verification, bank account)
3. `account.updated` webhook syncs `charges_enabled` / `payouts_enabled` back to `organizer_accounts` table
4. Ticket payments use **destination charges**: buyer pays DVNT → DVNT keeps `application_fee_amount` → rest auto-transfers to organizer's Connect account

### 4d. Connect Redirect URIs

The onboarding flow uses deep links for return/refresh:

- **Return URL**: `dvnt://organizer/connect?success=true`
- **Refresh URL**: `dvnt://organizer/connect?refresh=true`

No configuration needed in Stripe for these — they're passed as params when creating the account link.

---

## 5. Enable Stripe Tax (Optional but Recommended)

Multiple checkout flows have `automatic_tax[enabled]: true`. For this to work:

**Dashboard → Settings → Tax**

1. Enable Stripe Tax
2. Set your **origin address** (where DVNT is based)
3. Set **product tax code**: `txcd_10000000` (General - Electronically Supplied Services) or more specific codes as needed
4. Register tax IDs for states/countries where you have tax obligations

> If you don't enable Stripe Tax, the `automatic_tax` parameter is ignored silently — no error, just no tax collected.

---

## 6. Customer Portal (for Sneaky Lynk Subscriptions)

The `sneaky-billing-portal` edge function creates Stripe Billing Portal sessions.

**Dashboard → Settings → Billing → Customer portal**

Configure:

- **Subscriptions**: Allow customers to cancel, switch plans
- **Payment methods**: Allow customers to update card
- **Invoices**: Allow customers to view/download invoices
- **Return URL**: `dvnt://sneaky/billing` (this is also set in code, but configuring it in the portal settings is a fallback)

---

## 7. Products & Prices (Sneaky Lynk Subscriptions)

The `sneaky-billing-checkout` function auto-creates products/prices if they don't exist, but you can pre-create them for cleaner dashboard organization:

### Option A: Auto-creation (default)

The edge function creates products/prices on first checkout and saves the IDs to the `sneaky_subscription_plans` table. No manual setup needed.

### Option B: Pre-create in Dashboard

**Dashboard → Product catalog → Add product**

| Product             | Price                                                      | Interval |
| ------------------- | ---------------------------------------------------------- | -------- |
| Sneaky Lynk Host 25 | Match `price_cents` from `sneaky_subscription_plans` table | Monthly  |
| Sneaky Lynk Host 50 | Match `price_cents` from `sneaky_subscription_plans` table | Monthly  |

After creating, copy the `price_xxx` IDs into the `sneaky_subscription_plans.stripe_price_id` column in your database.

---

## 8. Radar (Fraud Protection)

**Dashboard → Radar → Settings**

Radar is enabled by default on all Stripe accounts. The app handles `radar.early_fraud_warning.created` events. For enhanced protection:

1. Enable **Radar for Fraud Teams** (paid add-on) if you want custom rules
2. Consider adding rules like:
   - Block payments from high-risk countries
   - Review payments over a certain amount
   - Block if velocity exceeds threshold (e.g., 5 purchases in 1 hour)

---

## 9. Fee Structure Reference

The app uses fee policy version `v1_250_1pt`:

| Component         | Rate             | Description                    |
| ----------------- | ---------------- | ------------------------------ |
| **Buyer fee**     | 2.5% + $1/ticket | Added on top of ticket price   |
| **Organizer fee** | 2.5% + $1/ticket | Deducted from organizer payout |
| **DVNT total**    | 5% + $2/ticket   | Platform revenue               |

This is implemented in `supabase/functions/_shared/fee-calculator.ts`. Stripe's own processing fees (2.9% + $0.30) are absorbed within the DVNT fee.

---

## 10. All Supabase Secrets Summary

Set all of these via `npx supabase secrets set KEY=VALUE`:

```bash
# Stripe Core
STRIPE_SECRET_KEY=sk_test_...              # or sk_live_...
STRIPE_PUBLISHABLE_KEY=pk_test_...         # or pk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...            # Main webhook signing secret

# Stripe Promotions (separate webhook)
STRIPE_PROMOTION_WEBHOOK_SECRET=whsec_...  # Promotion webhook signing secret

# Ticket QR Code Security
TICKET_HMAC_SECRET=<random-64-char-hex>    # Used for HMAC-signed QR codes

# Cron Jobs (payouts-release, reconcile-orders)
CRON_SECRET=<random-string>                # Auth header for cron-triggered functions

# Payout Emails (payouts-release sends statements to organizers)
RESEND_API_KEY=re_...                      # From https://resend.com/api-keys
RESEND_FROM_EMAIL=DVNT <noreply@dvntapp.live>  # Optional, defaults to this value
```

---

## 11. All Stripe Edge Functions

These are the edge functions that interact with Stripe. All must be deployed with `--no-verify-jwt`:

| Function                  | Purpose                               | Stripe Features Used                                                   |
| ------------------------- | ------------------------------------- | ---------------------------------------------------------------------- |
| `create-payment-intent`   | Native PaymentSheet ticket checkout   | PaymentIntents, Customers, Ephemeral Keys, Connect destination charges |
| `ticket-checkout`         | Web Checkout Session ticket checkout  | Checkout Sessions, Connect destination charges                         |
| `stripe-webhook`          | Main webhook handler (17 event types) | Webhook signature verification                                         |
| `sneaky-access-checkout`  | $2.99 Sneaky Lynk access paywall      | Checkout Sessions (one-time payment)                                   |
| `sneaky-billing-checkout` | Sneaky Lynk subscription checkout     | Checkout Sessions (subscription mode), Customers, Products, Prices     |
| `sneaky-billing-portal`   | Subscription management portal        | Billing Portal Sessions                                                |
| `organizer-connect`       | Organizer Stripe Connect onboarding   | Connect Accounts, Account Links                                        |
| `payment-methods`         | List/add/remove/set default cards     | PaymentMethods, SetupIntents, Customers                                |
| `payouts-release`         | Cron: release organizer payouts       | Transfers (to Connect accounts)                                        |
| `reconcile-orders`        | Cron: fix stuck orders                | PaymentIntent/Checkout Session status reads                            |
| `promotion-checkout`      | Event spotlight promotion purchase    | Checkout Sessions (one-time, platform revenue)                         |
| `promotion-webhook`       | Promotion payment webhook             | Webhook signature verification                                         |
| `host-payouts`            | Organizer payout dashboard data       | Reads from DB (no direct Stripe calls for list)                        |
| `host-disputes`           | Organizer dispute dashboard           | Disputes list via Stripe API                                           |
| `host-transactions`       | Organizer transaction history         | Reads from DB                                                          |
| `purchases`               | Buyer purchase history/receipts       | PaymentIntent reads for receipt data                                   |

### Deploy command

```bash
npx supabase functions deploy <function-name> --no-verify-jwt --project-ref npfjanxturvmjyevoyfo
```

---

## 12. Going Live Checklist

When switching from test to production:

- [ ] **Activate your Stripe account** — complete business verification in Dashboard
- [ ] **Switch API keys** — replace all `pk_test_` / `sk_test_` with `pk_live_` / `sk_live_`
- [ ] **Create new webhook endpoints** — production webhooks with live signing secrets
- [ ] **Update Supabase secrets** — all 4 Stripe secrets (secret key, publishable key, 2 webhook secrets)
- [ ] **Update client `.env`** — `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY` with live key
- [ ] **Verify Connect** — ensure Connect is enabled in live mode
- [ ] **Verify Tax** — ensure Stripe Tax registrations are set for live mode
- [ ] **Configure Customer Portal** — portal settings are mode-specific
- [ ] **Test end-to-end** — use real cards (small amounts) to verify the full flow
- [ ] **Push OTA update** — so the app uses the live publishable key
- [ ] **Monitor** — watch Dashboard → Developers → Logs for the first few days

---

## 13. Testing in Test Mode

### Test Card Numbers

| Card      | Number                | Use                             |
| --------- | --------------------- | ------------------------------- |
| Success   | `4242 4242 4242 4242` | Standard successful payment     |
| Decline   | `4000 0000 0000 0002` | Card declined                   |
| 3D Secure | `4000 0025 0000 3155` | Requires authentication         |
| Dispute   | `4000 0000 0000 0259` | Creates a dispute after payment |

### Test Webhook Events

**Dashboard → Developers → Webhooks → select endpoint → Send test webhook**

You can trigger any of the 17 event types to verify your webhook handler processes them correctly.

### Stripe CLI (local development)

```bash
# Install
brew install stripe/stripe-cli/stripe

# Login
stripe login

# Forward events to local Supabase
stripe listen --forward-to http://localhost:54321/functions/v1/stripe-webhook

# Trigger test events
stripe trigger payment_intent.succeeded
stripe trigger checkout.session.completed
```

---

## 14. Stripe API Version

The codebase pins to **`2026-02-25.clover`** in the `Stripe-Version` header for ephemeral keys and billing operations. This is set explicitly in `create-payment-intent` and `sneaky-billing-checkout`.

**Dashboard → Developers → API version** — pin your account to this version or newer. Upgrading the API version in Stripe Dashboard does NOT auto-update your webhook event shapes — you'll need to update webhook endpoints separately.
