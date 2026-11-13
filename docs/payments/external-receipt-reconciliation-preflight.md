# External promoter receipt: preflight, not a payout release

This document and the offline checker are deployment-free. They do not mark any
person paid, move money, disable a worker, alter a hold or certify a receipt.
A person's report that they paid externally is a reason to reconcile, not a
reason to submit a second Stripe transfer. Do not commit real receipt contents,
recipient identifiers or live ledger IDs to this repository.

## Immediate handling

1. Obtain the completed provider receipt: actual amount/currency, recipient,
   transaction reference and payment date/time. Verify the recipient against
   the intended promoter independently. Hide unrelated balances/card details.
   Pending, failed, reversed or unverified payments are not settlement evidence.
2. Keep the event's existing `on_hold` quarantine and null release date. This
   condition is required by the canonical recording transaction, not something
   to clear before recording. A dispute hold is not a durable external-payment
   exclusion: ordinary webhook activity can change it later.
3. Reconcile every applicable Stripe destination, old payout claim, in-flight
   worker and uncertain provider outcome. No registered cron is not proof that
   manually invoked or already-running workers cannot pay. Draining/changing
   production execution requires separate authorization.
4. Retain an independently reviewed, access-controlled immutable receipt copy;
   record its digest and opaque version reference. A digest proves integrity,
   not provider authenticity. Do not fabricate a Stripe transfer ID.
5. Confirm the receipt amount exactly matches the intended whole earning rows.
   Do not round, silently write off a remainder or stamp all rows for a partial
   payment. The canonical draft does not split arbitrary partial payments. A
   mismatch stays quarantined for a separate allocation/reconciliation design.

## Why neither existing draft is a one-click receipt-only rollout

The external slice in #285 is stacked on a paused checkpoint with an empty
aggregate migration. Its canonical `settlement-external.sql` depends on seven
pre-existing settlement tables: `allocations`, `bank_proofs`, `checkouts`,
`controls`, `deliveries`, `holds`, and `orders`, plus shared helpers and schema.
It overrides summaries and obligation logic and installs recovery triggers.
Copying only the receipt table or stubbing these dependencies loses the safety
contract. #286 assembles them but also contains the full checkout/runtime work;
it is not an approved narrow production release.

A standalone extraction is substantial engineering, not a migration edit. The
current canonical SQL uses unconditional CREATE statements. Installing a subset
first would collide with the future aggregate migration unless its forward
adoption path is designed and tested. Do not introduce another paid-external
flag or ledger that #286 cannot recognize.

## Required narrow-release contract (not implemented by this PR)

The smallest acceptable proposal would include ONLY the reviewed guard schema,
a revised legacy claimant/eligibility reader, private evidence recording,
truthful external-payment display, and its future-runtime adoption migration.
It must retain these canonical invariants:

- Exact authenticated operator, independently verified recipient binding,
  completed receipt, immutable private evidence and positive whole-row scope.
- Locks on event/source orders/exact ledger rows in the canonical order;
  atomic receipt, ledger association, funding invalidation and exclusions.
- Reject disputed/refunded/reversed sources, absent attribution, existing
  aggregate payout/legacy claim, any reserved/uncertain/transferred promoter
  delivery, receipt reuse or conflicting replay. Unknown is not absent.
- Preserve original earnings/economics and immutable recipient/source identity.
  Keep audit records append-only; no fabricated provider ID or false bank-paid
  status. Keep client/service direct access revoked and operator list empty
  until explicitly authorized provisioning.
- Permanently exclude the WHOLE event from legacy aggregate organizer payout,
  even if dispute holds clear. Otherwise marking promoter rows paid removes
  their deduction from the old organizer calculation and can fund the host
  twice, especially for legacy destination charges.
- Block later promoter reservation using the SAME canonical external rows that
  #286 recognizes. Later refunds/disputes produce manual recovery review,
  never fictitious provider reversals. Receipt recording cannot undo a payment
  that raced it before the record existed.

Before rollout, test exact-head disposable PostgreSQL races in BOTH orderings
(external vs Stripe reservation, external vs legacy claim), duplicate receipt
and scope replay, ACLs/default grants, rollback, immutable row/source identity,
hold clearing, host accounting and future #286 migration adoption. Tests against
synthetic schemas alone do not prove compatibility with production triggers or
migration history. Do not weaken risk checks merely to accept a historical
receipt.

## Concrete approval surfaces, in order

Approval must identify the reviewed artifacts, environment and scope. Do not
bundle these into an unspecified "fix payouts" or request all-payout execution.

1. Production execution drain/quarantine plan and verification, including old
   in-flight/uncertain outcomes. Do not reset claims to make checks pass.
2. Exact guard migration and revised legacy claimant deployment, with all
   money-moving/new-checkout/runtime gates still disabled. Verify schema,
   migration history, trigger/ACL composition and canonical adoption contract.
3. Narrow private operator and independently verified recipient provisioning.
   Apply any stricter security/permission confirmation requirement separately.
4. Exact evidence-backed record: specified recipient, amount/currency, provider
   reference and exact reviewed earning rows. This is bookkeeping, not another
   transfer. Verify committed audit, replay behavior, protected ledger stamps,
   permanent organizer exclusion and the remaining unpaid balance afterward.

Do not claim the duplicate risk is eliminated until those live outcomes are
verified. Do not cancel unrelated top-ups or pay any remaining balance as a
side effect. Payment, funding, production deployment and permission changes
retain their own approval requirements.

## Offline checker

Run `node --test scripts/test-external-receipt-preflight.cjs` for synthetic
checklist tests. Run `node scripts/check-external-receipt-preflight.cjs` with a
normalized JSON evidence manifest on stdin. The fixture in the test describes
version1 fields. Use opaque local aliases, not receipts, names or account
numbers. No API, database or filesystem write is performed by the checker.

The manifest's `review` booleans are supplied assertions, NOT facts the checker
verifies. Row risk fields must explicitly be false; omitted/unknown state fails
closed. Timestamps must include timezone and not be future dates. USD is the
only supported currency in this narrow checklist. Provider references with
other punctuation should be represented by a private opaque alias, not modified
in the actual provider record. Invalid JSON is not echoed. Input is bounded to
128KiB. Output never includes input references or amounts.

Exit0 means ONLY that the supplied checklist is internally complete. Exit1
means missing/inconsistent evidence; exit2 means invalid/bounded input.
`deployment_ready` is ALWAYS false. The checker has no lock, provider read,
authentication authority or durable receipt storage. Its replay test is purity,
not database idempotence. It cannot test race exclusion, actual ACLs, receipt
truth, current live eligibility or any production rollout. Those remain the
explicit implementation and verification gates above.
