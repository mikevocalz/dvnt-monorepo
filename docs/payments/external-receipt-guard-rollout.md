# Narrow external-payment guard: review candidate, not activated

This branch adds no checkout routing, scheduler or provider-money operation.
The SQL candidate is `docs/payments/drafts/external-receipt-guard.sql`. No live
migration or operation is implied by publication. Never apply it to fill a test
gap. #290's offline checklist remains a separate planning aid.

## Two distinct actions

**Report/quarantine:** an authorized, scoped operator reports an external payment
without claiming it completed. The transaction preserves the event/promoter's
identity and existing earning-row/source snapshots in private
`external_event_quarantines` / `external_reported_rows`. These are durable guard
metadata, NOT another paid ledger. Ledger earnings remain pending. Quarantine
blocks legacy claims and aggregate payout writes even if mutable event holds
clear; several promoters can have independent reports on one event. Exact
report replay is harmless; altered replay fails. Later claims cannot be assumed
safe merely because a time-limited drain review expired. There is no generic
owner unblock or delete API. An already-started provider operation cannot be
stopped retroactively; the report returns an in-flight-review indicator.

**Record completed receipt:** only independently verified completed evidence,
matching immutable recipient binding and exact positive whole earning rows, can
produce canonical `external_promoter_payments`, `external_promoter_rows` and
permanent event exclusion. Original earnings remain unchanged; paid stamps have
no fabricated Stripe ID. Pending/failed/partial/unknown evidence, scope drift,
prior claims/payouts, reversal/refund/dispute states or mismatched economics fail
closed. Supported source: paid `event_ticket`, complete earning rows only.
Arbitrary partial receipt allocation is deliberately unsupported.

Report and recording have separate default-off DB controls and endpoint flags:
`reporting_enabled` / `EXTERNAL_PROMOTER_REPORTING_ENABLED`, and `enabled` /
`EXTERNAL_PROMOTER_RECORDING_ENABLED`. Operators default absent/disabled. Private
operator scopes explicitly bind actor + event + promoter, separate report/record
rights and finite expiry. A report-only incident approval does not grant receipt
recording or global payout administration.

## Actual authenticated path and evidence boundary

Endpoints derive actor identity exclusively from a valid, non-expired DVNT
session, then verify private operator authorization and exact scoped DB rights.
They reject caller-supplied actor fields, bound streamed bodies, redact errors
and never log receipt contents. A Supabase read connector is NOT a DVNT operator
session. Do not invent a user session, impersonate an owner by calling the RPC
with their actor ID, or presume current connector access authorizes provisioned
financial administration. A separately approved administrator/service invocation
must have its actual audited identity and authorization, not a fabricated user.

Before recording, a separately reviewed administrator must establish the actual
private retained receipt location/version, verify provider authenticity and
recipient binding, and append current drain/provider reconciliation evidence.
`external_event_reviews` keeps immutable history and allows new review rows;
proof expires within fifteen minutes and is rechecked after locks. The reviewer
must be the recording actor. Hashes and opaque references prove neither actual
storage retention nor provider payment authenticity. No storage permissions,
credentials or retention promises are configured by this patch.

## Legacy compatibility

The revised legacy handler uses a service-only atomic claim before any Stripe
call. Missing RPC, quarantine, permanent exclusion, prior claim or malformed
claim fails closed. It preserves the old `processing` transition. The current
live event constraint rejects that transition; this patch does NOT add
`processing` or enable unrelated destination-funded aggregate transfers. The
migration must be installed and verified before this handler; otherwise all
claims fail closed on missing RPC. This dependency must be explicitly approved,
not hidden as a global policy change. Old workers already past their claim must
be drained and provider outcomes reconciled before installation/enablement.

Report captures existing earning obligations only; it does not label future
sales externally paid or change existing checkout routes. The event-wide legacy
aggregate exclusion protects the host calculation. Never clear it by marking
promoter rows paid and recomputing an organizer remainder: historical destination
charges already funded the organizer. Direct trusted-admin/provider-dashboard
transfers remain outside this database guard and require operational discipline.

Canonical payment tables deliberately match #285/#286. No runtime tables are
stubbed. Standalone recording refuses to operate if a full runtime appears
without reviewed adoption. The full #286 migration needs a tested transactional
forward-adoption path preserving all existing receipt IDs, reported scope,
quarantines, scopes, evidence, ACLs and defaults and installing new-runtime
reservation interlocks BEFORE execution. Do not apply its unconditional CREATE
statements over these objects. Adoption implementation/review is a separate
stack; neither draft alone certifies the composed future runtime.

## Truthful status

`external-promoter-payment-status` uses a separately default-off status flag and
returns only the verified session actor's frozen beneficiary summary, including
reported/pending-review versus manually verified external receipt versus later
recovery review. It exposes no private receipt/provider reference, never claims
Stripe transfer or bank payout, and does not reassign history to a new promoter
owner. The existing Earnings display remains lifetime earnings, not proof of
payment; existing Connect-enabled text is account readiness only. This narrow
patch adds the status API, NOT full beneficiary-screen integration. Deploying it
does not make the current screen show an external-payment badge. That UI wiring
remains explicit work before claiming an end-to-end user experience.

## Required production approval and verification

1. Review actual source schema/constraints/triggers/migration history and final
   exact artifact. Obtain explicit installation/deployment/drain approval.
2. Reconcile prior and uncertain provider outcomes; drain old workers. No cron
   entry is not proof no manual/in-flight execution exists.
3. Install verified guard SQL, revised claimant and approved endpoints, keeping
   all controls/flags disabled. Verify restrictive ACLs and immutable metadata.
4. Separately authorize scoped real operator provisioning and reporting gate;
   report the specified event/promoter using its actual session. Verify durable
   quarantine and that no earning has been falsely marked paid.
5. Only after receipt/evidence review, authorize the exact bookkeeping action,
   correct recipient binding, fresh review and limited recording gate. Verify
   atomic canonical receipt/stamps/exclusion, replay and remaining obligations.
6. Keep later refunds/disputes/reversals in manual external-recovery review.
   This implementation cannot reverse a Cash App payment through Stripe.

No payment, cancellation of top-ups, new payout schedule, broad permissions or
fund movement is authorized by these steps. Do not call this production-ready
until native cross-process tests, exact-head CI, independent security review,
actual live-schema compatibility and required operational gates are verified.

## Tests and limitations

Focused PGlite SQL tests exercise actual candidate SQL; endpoint tests exercise
actual handler code and the strict session helper. Independent adversarial tests
cover permissive default grants, captured pending scope and identity protection.
Native PostgreSQL17 runner is restricted to disposable GitHub-hosted CI, rejects
external DB routing variables, and observes real blocking overlaps. Local
PGlite is not proof of cross-process locks. A green test is not provider receipt
verification, production migration execution, real account access or rollout
approval. Run both focused and native tests on the final exact commit.
