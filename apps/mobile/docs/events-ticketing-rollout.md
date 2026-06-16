# Events + Ticketing + Sneaky Link Paywall — Rollout & Test Plan

## Feature Flags (all default OFF)

| Flag | Env Var | Controls |
|------|---------|----------|
| `events_enabled` | `EXPO_PUBLIC_FF_EVENTS_ENABLED` | Events list, detail, create |
| `event_weather_enabled` | `EXPO_PUBLIC_FF_EVENT_WEATHER_ENABLED` | NOAA weather module on detail |
| `ticketing_enabled` | `EXPO_PUBLIC_FF_TICKETING_ENABLED` | Ticket purchase + My Tickets |
| `organizer_tools_enabled` | `EXPO_PUBLIC_FF_ORGANIZER_TOOLS_ENABLED` | Scanner, ticket list, dashboard |
| `payouts_enabled` | `EXPO_PUBLIC_FF_PAYOUTS_ENABLED` | Stripe Connect payouts |
| `sneaky_paywall_enabled` | `EXPO_PUBLIC_FF_SNEAKY_PAYWALL_ENABLED` | $2.99 paywall after 10 users |
| `nsa_enabled` | `EXPO_PUBLIC_FF_NSA_ENABLED` | NSA anonymous mode |

---

## Safe Rollout Order

### Stage 1 — Database (no user impact)
1. Run migration `20260301_events_ticketing_v2.sql`
2. Verify all tables created, RLS policies active
3. Test RLS with service role and anon role

### Stage 2 — Events (read-only first)
1. Enable `events_enabled=true` in staging
2. Verify events list loads, detail pages work
3. Verify create event wizard works
4. Test all event category types
5. Test visibility: public, private, link_only

### Stage 3 — Weather Module
1. Enable `event_weather_enabled=true`
2. Verify NOAA API works for US locations
3. Verify graceful degradation for non-US / invalid coords
4. Verify skeleton → fade-in animations

### Stage 4 — Ticketing (purchase flow)
1. Enable `ticketing_enabled=true`
2. Set up Stripe test mode
3. Test free ticket issuance (no Stripe)
4. Test paid ticket checkout via expo-web-browser
5. Verify webhook creates tickets with QR tokens
6. Verify My Tickets screen shows purchased tickets
7. Test duplicate webhook handling (idempotency)

### Stage 5 — Organizer Tools
1. Enable `organizer_tools_enabled=true`
2. Test VisionCamera scanner on physical device
3. Test scan → success / already_scanned / invalid flows
4. Test organizer ticket list with filters
5. Test offline scanner download + validation + reconcile

### Stage 6 — Payouts
1. Enable `payouts_enabled=true`
2. Test Stripe Connect Express onboarding flow
3. Verify payout_release_at business day calculation
4. Test payouts-release cron in staging
5. Verify payout statement email (Resend)
6. Test dispute → on_hold flow

### Stage 7 — Sneaky Link Paywall
1. Enable `sneaky_paywall_enabled=true`
2. Test join guard: first 10 free
3. Test paywall modal appearance for 11th user
4. Test iOS external purchase flow compliance
5. Test Android Stripe Checkout flow
6. Verify webhook grants access

### Stage 8 — NSA Mode
1. Enable `nsa_enabled=true`
2. Test NSA toggle on join
3. Verify DMs go to Requests
4. Verify chat screen unchanged

---

## Test Plan

### 1. Events Create/Edit
- [ ] Create public event → visible in list
- [ ] Create private event → only visible to host + invitees
- [ ] Create link_only event → accessible via share link only
- [ ] Edit event → changes reflected
- [ ] Delete event → removed from list
- [ ] All 24 category types selectable
- [ ] Age restriction badges show correctly (18+, 21+)
- [ ] NSFW toggle works
- [ ] Vibes media upload (up to 4)
- [ ] Location autocomplete + lat/lng stored

### 2. Tickets
- [ ] Free ticket: checkout → ticket created instantly → QR renders
- [ ] Paid ticket: checkout → Stripe opens → webhook → ticket created
- [ ] Duplicate scan blocked (already_scanned)
- [ ] Refund marks ticket as refunded
- [ ] Max per user enforced
- [ ] Quantity sold increments correctly
- [ ] My Tickets list shows all user's tickets
- [ ] QR token is unique per ticket

### 3. Organizer
- [ ] Organizer sees ticket list for their event
- [ ] Search/filter by status works
- [ ] Scanner opens camera (VisionCamera)
- [ ] Valid scan → green check + name + tier
- [ ] Already scanned → yellow warning
- [ ] Invalid QR → red error
- [ ] Torch toggle works
- [ ] Scan count persists in session
- [ ] Haptic feedback on scan

### 4. Offline Mode
- [ ] Download allowlist stores HMAC hashes in MMKV
- [ ] Offline validation: valid token → success
- [ ] Offline validation: invalid token → rejected
- [ ] Offline validation: duplicate scan → rejected
- [ ] Reconcile uploads scanned tokens
- [ ] Cross-device guidance shown in UI

### 5. Payouts
- [ ] payout_release_at = end_time + 5 business days
- [ ] Friday end → next Friday release
- [ ] Cron finds due events and transfers funds
- [ ] Dispute sets payout_status=on_hold
- [ ] Payout email includes correct breakdown
- [ ] Net calculation: gross - 5% - $1/ticket - Stripe fees - refunds

### 6. Sneaky Link Paywall
- [ ] First 10 participants join free
- [ ] 11th user sees paywall modal
- [ ] Host never sees paywall
- [ ] $2.99 payment → webhook → access granted → join succeeds
- [ ] iOS: "Continue to Payment" (external link, compliant)
- [ ] Android: "Pay $2.99" (Stripe Checkout)
- [ ] Already paid user can rejoin without paying again

### 7. Weather
- [ ] Forecast loads for US events with lat/lng
- [ ] 7 daytime periods shown
- [ ] Lucide icons map correctly (Sun, CloudRain, etc.)
- [ ] Expand card shows wind + precipitation
- [ ] Skeleton shimmer while loading
- [ ] Error state for invalid/non-US locations
- [ ] No render if event has no lat/lng

### 8. Stripe Integration
- [ ] Connect Express onboarding link opens
- [ ] Account status syncs after onboarding
- [ ] Destination charge + application_fee_amount correct
- [ ] Webhook signature verification works
- [ ] Idempotent: duplicate events skipped
- [ ] Radar rules: high-risk blocked, elevated requires 3DS

---

## Secrets Required

| Secret | Location |
|--------|----------|
| `STRIPE_SECRET_KEY` | Supabase secrets |
| `STRIPE_WEBHOOK_SECRET` | Supabase secrets |
| `RESEND_API_KEY` | Already configured |
| `RESEND_FROM_EMAIL` | Already configured (noreply@dvntapp.live) |

## Stripe Dashboard Configuration
1. Enable Connect → Express accounts
2. Configure branding
3. Enable Radar
4. Add rules: Block risk_level=highest, 3DS for elevated/high amounts
5. Register webhook endpoint: `{SUPABASE_URL}/functions/v1/stripe-webhook`
6. Events: checkout.session.completed, charge.refunded, charge.dispute.created, account.updated
