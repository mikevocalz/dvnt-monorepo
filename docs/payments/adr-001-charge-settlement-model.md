# ADR-001: Charge and settlement model

Status: Approved — Mike confirmed on 2026-09-19  
Date: 2026-09-19  
Scope: DVNT ticket orders, promoter payouts, organizer settlements

---

## Context

DVNT moves money for event tickets through Stripe Connect. Two connected parties currently receive funds from a single ticket sale:

1. The **organizer** (event host / connected account).
2. **Promoters** who drove the sale (external individuals or DVNT users, paid by transfer from the organizer's net).

The codebase also mixes two different Stripe Connect charge patterns and a second settlement sweep, which creates a real double-funding risk.

### Current checkout paths

Three server-side endpoints create Stripe payment objects:

| Endpoint | File | Charge pattern |
|---|---|---|
| `ticket-checkout` | `apps/mobile/supabase/functions/ticket-checkout/index.ts:548-552` | Destination charge: `payment_intent_data[application_fee_amount]` + `payment_intent_data[transfer_data][destination]` |
| `cart-checkout` | `apps/mobile/supabase/functions/cart-checkout/index.ts:400-401` | Destination charge: `application_fee_amount` + `transfer_data[destination]` |
| `create-payment-intent` | `apps/mobile/supabase/functions/create-payment-intent/index.ts:453-454` | Destination charge: `application_fee_amount` + `transfer_data[destination]` |

All three are **destination charges**: the full charge lands on the platform account and is immediately transferred to the organizer's connected account, minus the `application_fee_amount` retained by DVNT <ref_file file="/Users/mikevocalz/dvnt-monorepo/apps/mobile/supabase/functions/ticket-checkout/index.ts" />, <ref_file file="/Users/mikevocalz/dvnt-monorepo/apps/mobile/supabase/functions/cart-checkout/index.ts" />, <ref_file file="/Users/mikevocalz/dvnt-monorepo/apps/mobile/supabase/functions/create-payment-intent/index.ts" />.

### Current settlement sweep

`payouts-release` runs hourly and, for every event whose `payout_release_at` has passed and `payout_status = 'pending'`, computes `organizerNetCents` from tickets and posts a `/transfers` to the organizer's connected account <ref_file file="/Users/mikevocalz/dvnt-monorepo/apps/mobile/supabase/functions/payouts-release/index.ts" />, <ref_snippet file="/Users/mikevocalz/dvnt-monorepo/apps/mobile/supabase/functions/payouts-release/index.ts" lines="445-457" />.

This is **a second transfer** on top of the destination-charge transfer. For any order created by the three checkout paths above, the organizer receives funds twice: once at payment time via the destination charge, and again at release time via `payouts-release`.

### Promoter earning today

`recordPromoterEarning` in the shared order-state helper bases the promoter earning on the organizer's net after DVNT fees:

```
earning = floor(locked_rev_share_bps × organizer_transfer_amount / 10000)
organizer_transfer_amount = subtotal_cents − organizer_fee_cents
```

<ref_file file="/Users/mikevocalz/dvnt-monorepo/apps/mobile/supabase/functions/_shared/order-state.ts" />, <ref_snippet file="/Users/mikevocalz/dvnt-monorepo/apps/mobile/supabase/functions/_shared/order-state.ts" lines="60-69" />.

### Refund behavior today

`recordPromoterReversal` always reverses the **entire** earning, even on a partial refund:

<ref_snippet file="/Users/mikevocalz/dvnt-monorepo/apps/mobile/supabase/functions/_shared/order-state.ts" lines="170-174" />.

---

## Decision

Adopt **separate charges and transfers** for all new ticket orders. A single order is never both a destination charge and the target of a later organizer transfer.

### Why separate charges and transfers

Stripe's guidance distinguishes the two models:

- **Destination charges** move funds to the connected account at payment success. They are not suited to hold-and-release because the transfer is automatic and immediate, and they are designed for a single connected account per charge <ref_file file="/var/folders/37/s0s6qm2x3cx1mdsr_fv0y1pr0000gn/T/devin-overflows-501/5750f22c/content.txt" />, <ref_file file="/var/folders/37/s0s6qm2x3cx1mdsr_fv0y1pr0000gn/T/devin-overflows-501/c1c95390/content.txt" />.
- **Separate charges and transfers** create the charge on the platform account and let the platform decide later how much to transfer and to whom. This is the recommended pattern when one payment must be split across several connected accounts (organizer + promoter) or when the recipient is not known at charge time <ref_file file="/var/folders/37/s0s6qm2x3cx1mdsr_fv0y1pr0000gn/T/devin-overflows-501/c1c95390/content.txt" />.

DVNT needs both: funds must be held on the platform until the event's payout window, then split between the organizer and any promoters. Destination charges cannot do this safely.

### Concrete rules

1. **One order, one `charge_model`**
   - Add a nullable/varchar column `orders.charge_model` with values `destination_charge` (historical) and `separate_charges_and_transfers` (new).
   - Every order row written after this ADR is implemented records its model.
   - Historical rows keep `destination_charge`.

2. **No second organizer transfer for a destination-funded order**
   - `payouts-release` skips any order whose `charge_model = 'destination_charge'`.
   - The only organizer transfer for such orders was the one created at payment time.
   - Enforced in code and covered by a test.

3. **Separate-charges-and-transfers orders**
   - The PaymentIntent / Checkout Session is created on the **platform account** with no `transfer_data[destination]` and no `application_fee_amount`.
   - DVNT's fee is retained by transferring **less** than the gross to the organizer.
   - Each Transfer carries `source_transaction` set to the charge id so it cannot land before the charge settles <ref_file file="/var/folders/37/s0s6qm2x3cx1mdsr_fv0y1pr0000gn/T/devin-overflows-501/c1c95390/content.txt" />, <ref_snippet file="/var/folders/37/s0s6qm2x3cx1mdsr_fv0y1pr0000gn/T/devin-overflows-501/c1c95390/content.txt" lines="1-50" />.
   - The sum of all transfers for a charge never exceeds the charge amount.
   - Promoter transfers are created at the same settlement time as the organizer transfer, from the organizer's share.

4. **Promoter commission basis**
   - Basis = eligible ticket subtotal **after** promoter discount, **before** organizer and processing fees.
   - Excludes taxes, buyer service fees, donations, and unrelated add-ons.
   - Commission comes from organizer proceeds, never an extra buyer charge.
   - Policy versioned on the order; historical rows keep their computed basis.

5. **Refunds and reversals**
   - Refunding a charge does **not** automatically reverse its transfers.
   - Partial refunds reverse promoter earning in proportion to the refunded eligible allocation, keyed by refund id.
   - Full refunds reverse the remainder.
   - The sum of reversals never exceeds the original earning.
   - If the recipient balance is short, record an explicit recovery obligation.

6. **Asynchronous payment methods**
   - For bank transfer / ACH, nothing is fulfilled or transferred before `charge.succeeded`.

### API version and account API pinning

This ADR does **not** upgrade Stripe. The repo currently uses a pinned Stripe API version and the original Account API for organizer onboarding. The upgrade to Accounts v2 and the latest API version is recorded as a follow-up in the ADR and is out of scope here, per the prompt's instruction that an unplanned Stripe upgrade in the middle of a payments change is a common cause of production breakage.

---

## Consequences

### Positive

- Eliminates the double-funding hazard between destination charges and `payouts-release`.
- Allows promoter payouts and organizer settlement to be computed and executed atomically from a single held balance.
- Makes the fee model explicit and auditable per order.
- Supports partial refund commission reconciliation correctly.

### Negative / migration cost

- Existing destination-charged orders must be excluded from `payouts-release`.
- New code must branch on `charge_model` for settlement, analytics, and refunds.
- Tests must cover both historical and new models.

### Follow-ups

- ADR-002: promoter account onboarding and capability requirements.
- ADR-003: policy decisions on commission basis, stacking, self-referral, held earnings, offline authorization, and legacy editor permissions.
- Migration: add `orders.charge_model`, backfill historical rows to `destination_charge`, add a database-level check or application guard preventing a destination-charge order from receiving an organizer transfer.

---

## References

- Stripe: Create separate charges and transfers — <https://docs.stripe.com/connect/separate-charges-and-transfers>
- Stripe: Create destination charges — <https://docs.stripe.com/connect/destination-charges>
- Stripe: Transfers API — <https://docs.stripe.com/api/transfers>
- Stripe: Payouts API — <https://docs.stripe.com/api/payouts>
- DVNT code: `apps/mobile/supabase/functions/_shared/fee-calculator.ts`
- DVNT code: `apps/mobile/supabase/functions/_shared/order-state.ts`
- DVNT code: `apps/mobile/supabase/functions/payouts-release/index.ts`
- DVNT code: `apps/mobile/supabase/functions/ticket-checkout/index.ts`
- DVNT code: `apps/mobile/supabase/functions/cart-checkout/index.ts`
- DVNT code: `apps/mobile/supabase/functions/create-payment-intent/index.ts`
