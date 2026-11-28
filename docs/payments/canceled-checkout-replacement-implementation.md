# Explicit canceled-checkout replacement: default-off draft

This is an offline implementation, not rollout approval or proof of provider behavior. It supports the four paid adapters within the catalog scope below. It does not provide a general retry button for failed, abandoned or uncertain payments.

## Implemented path

1. Authenticated requests use the existing verified session and exact original owner. Guests request a link to the original stored email address. The public request response never reveals whether an order exists. A 256-bit random, order-scoped, 15-minute capability is sent through the existing email boundary; only SHA-256 hashes are stored. The capability is captured into private volatile memory and removed from the URL before browser telemetry starts. Recovery documents disable telemetry/replay, and entering recovery stops recording for the remainder of that document. Opening the link does not exchange it. An explicit exchange consumes it once and returns a short-lived, purpose-scoped session held only in memory. Member/guest crossover and expired credentials fail closed. Email, IP and global limits are atomic.
2. Ownership is checked before retrieving any provider object. Fresh exact account, PaymentIntent, hosted session and charge-list evidence must prove final cancellation with zero received/capturable money and no charge history. Hosted sessions must also be expired and unpaid. The account, mode, order, model, currency, base amount and tax must match. Missing fields, absent references, search results, elapsed time and a local failure label never prove cancellation.
3. The buyer reviews a fresh five-minute server quote. Current event access/sale windows, tier/add-on/variant prices and capacity, promoter economics, release policy and funding prerequisites are checked. Acceptance repeats the authoritative quote under locks, verifies the exact accepted amount/currency and repeats the cancellation/financial-history checks. Changed prices or stock require a fresh review. An explicit first-acceptance HTTP409 price/expiry refusal allows that review; transport uncertainty and previously accepted quotes remain bound to exact-quote resumption. Historical refund/dispute/source/recovery/fulfillment evidence blocks, including ancestor history and late holds.
4. One serialized transaction creates at most one successor. Original orders, snapshots, cart IDs, line items, provider identities and financial history remain intact. Cart retries clone a new owner-bound cart and map every old line to its new identity. Existing cart uniqueness is retained. New stock reservations and successor lineage commit together. The duplicate guard remains in place for ordinary checkout across rails and canonical UUID/event spellings.
5. A durable one-shot provider claim precedes dispatch. Request retries can retrieve the exact saved provider object; they cannot create another payment after an unknown claim. A crash or missing response requires reconciliation. Identity is saved before a new payable secret/redirect is returned, and eligibility is rechecked after provider creation. A hold arriving during that request withholds the capability while preserving the observed object for reconciliation. This cannot revoke a secret already delivered earlier.
6. Web uses the existing Payment Element integration; native uses PaymentSheet. Neither acceptance, session creation, sheet completion nor a return URL claims payment/fulfillment. Switched identity/route and late responses cannot mount the old payment. Unknown acceptance resumes only its exact quote. Authenticated order details expose a review entry only when both server and client gates allow it. Guest recovery is a public web flow, including from native signed-out entry.

## Tax and accepted totals

Native/direct PaymentIntent replacements require acceptance of the exact final amount. Existing hosted automatic-tax checkouts retain that setting: the displayed accepted quote is explicitly the base amount, with tax calculated at Stripe checkout. The buyer separately reviews/confirms the final taxed amount there. No payment is confirmed by creating the hosted session. The normal provider source verifier checks the actual final currency/base/tax/total before settlement. No tax settings are changed or zero tax invented.

## Inventory lifecycle and operating limits

The default buyer-wide bound is two outstanding replacement reservations and 40 units across events, with at most 20 units in a new quote. Both member IDs and normalized guest identity use shared mutexes. Financially uncertain reservations remain counted.

A retained replacement hold has no automatic inventory-release TTL while a provider object can still collect money. Legacy expiration/failure cleanup cannot delete or release it. Real canonical ticket/cart issuance converts/releases stock atomically; failed issuance rolls back its temporary exemption.

The supported unpaid checkout window is 60 minutes, disclosed before buyer acceptance. A separately gated queue then attempts one direct-PI cancellation or hosted-session expiration. The timer only authorizes an attempt. Fresh exact final canceled zero-money proof is required to release stock. Processing, captured, charge-history, missing hosted PI and unknown outcomes retain stock and enter review. A lost cancellation response is not resent. A never-dispatched reservation can release only while atomically writing a permanent dispatch tombstone under the same locks as the claim. That tombstone cannot currently start another replacement chain; support review is required, not resurrection of the operation.

Service-only health and a bounded review queue expose overdue/uncertain inventory even when execution is paused. Existing deduplicated readiness alerts include these review obligations. No schedule, notification destination or cancellation job is activated by this draft. Operator ownership, cadence, provider permissions, end-to-end alert delivery and hard worker runtime bounds must be validated before enabling it.

## Supported and excluded selections

Supported within all four paid rails: public, flat-priced tickets; member carts with ordinary standalone/per-order add-ons and variants; current supported promoter terms; and existing hosted automatic tax. The original buyer/cart and organizer/promoter identity must remain valid.

Explicitly blocked pending separately reviewed adapters/policy:

- Absorb-mode fees. Existing shared fee snapshots retain inconsistent organizer/platform economics; replacement does not introduce a competing formula.
- Promo-code allocation, private or locked tiers, dynamic price schedules and special sub-allocations.
- Per-ticket add-on binding, donations and unsupported category/selection shapes.
- Organizer/promoter ownership changes or missing source/stock/funding contracts.
- Hosted sessions without an exact bound PI, any prior charge record, and all uncertain/partially captured/fulfilled/refunded/disputed states.

These are real limits, not claims that all possible checkout configurations now work.

## Flags and installation

SQL controls default false: checkout replacement, guest recovery and replacement cleanup. Deployment flags default off: CHECKOUT_REPLACEMENT_ENABLED, GUEST_CHECKOUT_RECOVERY_ENABLED, CHECKOUT_REPLACEMENT_CLEANUP_ENABLED. Existing separate-charge/worker gates still apply. NEXT_PUBLIC_CHECKOUT_REPLACEMENT_ENABLED and EXPO_PUBLIC_CHECKOUT_REPLACEMENT_ENABLED control only UI visibility and do not authorize a server action.

The reproducible runtime artifact includes recovery, replacement, then cleanup after the existing financial stack. Mandatory source-schema/function preflight prevents silently omitting stock or fulfillment protections. Current canonical inventory/issuance functions are loaded into synthetic tests; this is not proof of the deployed schema.

Issuer installation order agreed with the fulfillment-proof follow-up: canonical issuers, replacement inventory wrapper, then outer fulfillment receipt wrapper. The replacement wrapper is preserved inside that chain and failed issuance must roll back both inventory exemptions and receipts. New successor cart selections include accepted unit prices for exact fulfillment receipts. Priced original snapshots are matched to the original cart prices; older unpriced canceled snapshots remain recoverable without rewriting their history. Integration must test the combined artifact before publication/rollout.

Per-event cutover remains permanent. Never-cutover events can use legacy checkout; cutover events cannot silently fall back when model flags are disabled. Cohort transitions require quiescing/draining admitted legacy requests. Missing routing/schema data fails closed.

## Evidence and unresolved release gates

Checked-in tests exercise actual SQL, actual endpoint/coordinator authorization and synthetic provider/email boundaries, plus mounted web/native components and API state transitions. Real independent PostgreSQL sessions are covered by scripts/test-settlement-replacement-concurrency.py, restricted to disposable local GitHub Actions databases; the canonical psql-based CI command remains an exact-head release gate. Six checked-in replacement race groups also passed locally against a fresh, private, loopback-only PostgreSQL17.6 cluster using a separate streaming node-postgres command adapter. The adapter completed acquisition plus LOCKS_HELD as one query before sending delayed commit on the same connection. Independent observers verified 14 live uncommitted holders and 14 nonempty pg_blocking_pids results for their competitors. An earlier buffered single-query run was discarded because its marker did not prove overlap. This local adapter invocation did not forge CI mode or use an existing database, and is not a claim that the canonical psql CLI ran. The cluster was stopped after the tests.

The native runner covers duplicate successor/dispatch claims, last-unit stock, buyer reservation limits, guest exchange/email limits, late financial holds, cleanup/dispatch tombstone races, immutable cart revisions and paid-cart fulfillment racing cancellation proof. PGlite concurrent promises do not prove PostgreSQL lock behavior.

Mechanical composed-source check: scripts/check-replacement-fulfillment-composition.cjs accepts an exact local fulfillment SQL path and never silently skips a missing source. Eight real-issuer cases passed against fulfillment d2e0286117159a511f204ca447d8ed12ec5ce9c8 (source SHA-256 9a7724bfc2e37a6e9d2d4fc6d616209fd1de6f7976bd8de62cd802bfd0263b98): all four rails, priced/unpriced original carts, redeemable/nonredeemable add-ons, rollback and refusal to backfill unpriced historical receipts. These synthetic cases use zero actual tax. They establish wrapper composition only, not clearance of that fulfillment source.

Independent fulfillment review subsequently identified unresolved hosted automatic-tax completion ordering, canonical UUID proof comparison and add-on association/owner proof defects in that separate follow-up. The corrected final source must rerun composition plus real final-tax issuer ordering without pre-seeding order tax. This compatibility checkpoint does not repair or waive those findings.

Separate review corrections now include pre-telemetry recovery protection and explicit first-acceptance requoting. Their actual no-network Sentry/startup tests pass9/9, existing observability tests83/83, API/controller tests17/17, mounted replacement tests33/33 and actual endpoint/coordinator/SQL tests9/9. Independent clearance of these exact correction commits is still required.

Still required before release: final exact-commit native CI and combined issuer tests; independent security/economics review; real schema/constraint compatibility; dedicated Stripe sandbox and synthetic email-delivery integration; genuine web/native device validation; operator queue/alert delivery; bounded worker scheduling; approved event/cohort/risk policies; and separate production rollout authorization. The available Stripe context is live-only, so no provider sandbox success is claimed. No real payment, cancellation, email, migration, setting or deployment occurred here.
