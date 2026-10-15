# DVNT creator offer decisions — D01/D02/D03

**Status:** owner/legal decision required, not a code completion claim. The original D01 Deviant Events note is incomplete in the October 2 source record. Do not guess what it said. One-week creator offer, payment terms and rollout are not approved merely because an old PR exists.

## Decisions to record before any launch
- D01: supply the missing Deviant Events note verbatim, or explicitly retire it as superseded with the product owner's approval. Until then OPEN.
- D02: confirm whether the one-week free offer is a subscription promotion, ticket discount, creator trial or organizer program; specify eligible audience, start/end timezone, max quantity, fraud/duplication checks, cancellation behavior, taxes, refund and legal consent terms.
- D02 creator compensation: flat fee, revenue share, attendance bonus, thresholds, payout timing, chargebacks, tax reporting, KYC and creator agreement. The existing Supabase creator_compensation_plans table may contain configuration but its presence proves neither approval nor payment settlement. Immutable plan version must be attached before redemption.
- D03: anonymous-proximity policy maps to #98; screenshot/media to #99 and #102; post-event follow-ups to #101. Close D03 only when those acceptance gates and offer terms have evidence.

## Implementation foundation
CreatorOfferDecision and canActivateCreatorOffer are PURE, tested and inert. No promotions, grants, checkout modifications or payouts are made. An actual issuance endpoint must recheck policy and grants server-side using stable idempotency IDs, record an audit trail and enforce redeemed budget transactionally. Never rely on a client-side countdown or caller-supplied creator fee split.

## Product/legal decision record (to fill)
- Decision owner: pending
- Product offer: pending
- Authorized processor (where relevant): pending
- Sponsor/budget center: pending
- Currency and fee waterfall: pending
- Approval reference: pending
- Valid dates and eligibility: pending
- Recipient communication wording and consent: pending
- Revoke and refund rules: pending

Staff workstream: monetization product, distinguished payments engineer, trust/legal, finance QA, Impeccable UX writer, marketing skill and no-ai-slop. No merge or activation without explicit approval.
