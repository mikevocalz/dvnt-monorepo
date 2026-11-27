# Offline exact-row reservation/reconciliation reference

This is a test-only reference component, not a payment service, durable lock, payout fix, migration or provider adapter. It has no runtime imports. Every state and operation retains `executionAllowed: false`. Run `node --test scripts/test-promoter-exact-row-claim.mjs`.

The reducer freezes exact ledger/order/charge/source-transfer rows, beneficiary, amount, currency, source/destination accounts, provider and mode into an operation. It models version compare-and-swap, exclusive row ownership, stable operation keys, terminal receipt deduplication and indefinite reservation after uncertain outcomes. Calendar/release dates cannot alter operation identity. A successful transfer receipt is not evidence of a bank payout. No transition releases or retries uncertain or successful obligations.

It reuses the invariants of #286's recovery design, not its runtime: reserve before a provider boundary; preserve uncertain obligations; reconcile exact economics and source; never derive authorization from metadata alone. The normalized proof and registry are trusted test inputs. The component cannot authenticate those inputs and MUST NOT be exposed to a client or used as runtime authorization.

## Remaining production blockers

- Database transaction with CAS/locks, immutable operation storage, unique exact-row and provider-object ownership constraints, audited evidence retention and current exclusion/hold checks. Pure snapshots cannot prevent concurrent writers: two copies of version zero can both propose a reservation. A durable atomic adapter must reject the loser.
- Authenticated independent provider-object and source evidence; `sourceVerified` in the fixture is not an authority mechanism. Actual provider keys need server-allocated immutable operation IDs and provider/account/mode isolation.
- Authorized supported funding rail. Historical destination charges sent proceeds to the organizer. This model binds that organizer as source, but does not establish that Stripe supports the intended organizer-funded rail, that funds remain available, or that anyone approved moving them. It cannot convert host proceeds into platform funds.
- Durable outside-payment exclusions, including reported receipts whose exact event mapping remains unresolved, and event/dispute holds. Do not replace outside receipts with fabricated Stripe IDs. The reference rejects reported outside payments or missing exclusion evidence rather than guessing.
- No automatic release/backfill, existing aggregate runner activation, new provider key after timeout, balance-based top-up inference, organizer repayment or historical live writes.

The future two-business-day preview is isolated in #300. This component does not consume a release timestamp and cannot make historical rows automatically payable.
