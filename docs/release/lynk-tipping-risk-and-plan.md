# DVNT Lynk in-room tipping — S07

This is an **eligibility/test contract only**, not a working payments feature. No button is exposed, no payment API has been called and no processor/payout/fee decision is assumed.

## Processor / compliance gate
The published Stripe [Restricted Businesses](https://stripe.com/legal/restricted-businesses) includes platform-enabled content-related tips and adult live-chat offerings in restricted/prohibited categories. DVNT's adult community and Spicy/Lynk features require a provider-specific decision before a tip charge or transfer is built. Existing Stripe event ticketing acceptance does **not** establish tip eligibility. Obtain processor clearance in writing and record it privately; if unsupported, this feature stays disabled while a separately reviewed alternative is considered.

## Product questions for the owner
1. Eligible recipient: verified host only, co-host, speakers or selected creator partners?
2. Tip amount bounds, currency, platform fee, processor fees, chargeback/refund and tax handling?
3. Is tipping permitted for all rooms or only approved live events with consent?
4. How does web Stripe Connect coexist with native app-store billing policies? No direct mobile card-charge shortcut.
5. Should organizers with pending KYC have Tip action hidden until eligible? Safe default: hide.

## Build after approval
An accessible action beside Chat opens a recipient/amount/fee confirmation. The server—not the client—resolves creator account and verified payout state, active room membership and age. A stable operation ID prevents replay. Payment webhooks are signature-verified and ledger entries idempotent; refunds and disputes reverse accounting. Sender sees pending, succeeded or failed, never fake success. The UI is hidden until an actual compatible checkout exists on that platform.

## Test acceptance
Test missing processor permission, unverified viewer, inactive room, blocked recipient, incomplete payouts, out-of-range cents, copied idempotency IDs, repeat webhooks and refunds; provider sandbox only. Skills: Supabase/Postgres, Stripe documentation, Expo/skills, Matt Pocock TS, Impeccable, no-ai-slop and Mobbin. Specialist reviews: distinguished payments engineer, compliance, QA and privacy. This PR is draft and never merges or deploys without specific approval.
