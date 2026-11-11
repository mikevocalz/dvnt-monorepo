# Paid fulfillment before settlement: isolated follow-up

This patch is source-only and remains blocked for rollout. It changes no production data, payment settings, credentials, schedules or execution gates. The existing generated runtime migration is intentionally unchanged until the integration owner appends and reviews the new source.

## Defect and boundary

The paid provider source is not fulfillment evidence. At the original checkpoint, the real ticket issuer can reject a captured purchase for insufficient capacity, after which source verification marks the order paid and enrolls/transfers both allocations. For carts, that premature paid flag can also remove the order from normal paid-issuance recovery.

The new private `dvnt_settlement.fulfillments` journal is written in the same transaction as a successful, nonterminal invocation of the real canonical paid issuer. The receipt records the immutable checkout snapshot, exact PaymentIntent/session, gross amount, issuer and ticket/add-on entitlement identifiers. It is not an email result, paid status, metadata assertion or caller-supplied count. Client and service roles cannot insert/update/delete receipts or execute their constructor or the renamed inner issuers.

Ticket validation binds the complete bundle to the selected tier, original buyer/guest, order, payment/session, event, exact cardinality/indexes and total paid amount. Cart validation binds every original line, tier/add-on/variant, quantity and unit price, including add-on-only carts and per-unit redeemable add-ons. Before the first receipt, each add-on must reference the exact original admission ticket chosen by the canonical allocator (required-tier preference, then order index and ID); addon-only carts remain unbound. The manifest retains that ticket association. UUID identity is compared as UUID, so accepted uppercase, compact and braced spelling is equivalent without rewriting the frozen snapshot. Malformed IDs and invalid success-shaped legacy duplicates fail closed. A validation exception rolls back all writes by the issuer in that call.

Cart checkout snapshots now include each line's `unit_price_cents`. An older snapshot without that field does not receive automatic inferred proof. There is no receipt backfill. Existing unknown/partial allocations need the canonical issuer's exact replay or a separately reviewed recovery; this patch does not alter paid flags to force recovery.

The receipt describes the successful issuance event. Normal ownership transfers, scanning and add-on redemption do not erase that historical fact. Source verification and reservation still independently apply provider refunds/disputes, order terminal states, financial holds, funding and recipient checks. The receipt is not permission to override any of those gates.

## Hosted final-tax preparation

Hosted Stripe Checkout can capture a final total including automatic tax after the immutable checkout snapshot was created. The actual shared `session-issuance.ts` adapter now reads the current Session, PaymentIntent and Charge through the provider's read-only API before invoking the canonical issuer. A service-only SQL preparation RPC verifies their exact linked identities, original buyer/event/tier/quantity, frozen currency and pre-tax total, final tax/gross arithmetic, successful full capture, and absence of refund, dispute, destination charge or application fee. Caller webhook payload totals alone are not used.

The private immutable `hosted_captures` row pins that tuple. Preparation updates only the order's final total/tax and linked PaymentIntent. It does not mark paid, update paid time, enroll funds, release inventory or manufacture a fulfillment receipt. Missing/failed inventory remains recoverable. Terminal orders, changed captures and contradictory receipts fail closed. An existing valid receipt remains immutable.

Preparation takes only the order lock and completes before the adapter calls the issuer. It never waits on tier/cart/inventory locks or calls the issuer while holding the order. Actual adapter-to-real-SQL regression cases cover member and guest tax, stale webhook payloads, failed inventory and later recovery, then source verification and exactly-once settlement.

## SQL enforcement and ordering

- The source-verification wrapper takes the order lock, requires the immutable receipt, and only then calls the existing source/enrollment routine. Missing proof cannot mark an order paid or hide it from `reconcile-orders`.
- Enrollment has a defensive INSERT trigger requiring the receipt. New reservations have a defensive state-transition trigger requiring it. Already-sent transfer reconciliation remains possible without inventing fulfillment evidence.
- The error is `fulfillment_required`, retained in operational attention by the actual worker endpoint. The SQL processing whitelist also retains `runtime_budget_required` for integration with the independent runtime-budget patch. Unknown issuance creates no allocation, source credit, reservation or transfer.
- Issuer wrappers do not take an order lock before calling the canonical issuers. Ticket issuance preserves payment → tier → order; cart issuance preserves cart → order → inventory. Settlement never calls an issuer or waits on inventory while holding order → controls.

## Integration contract

1. Real source migrations must already exist: `20261021144500_paid_ticket_issuance_atomic.sql`, `20261009100200_cart_issuance_addon_ticket_and_units.sql`, `20261029024347_paid_cart_retry_fulfillment.sql`, and the latest paid-cart redefinition plus buyer-limit/category dependencies in `20261031142216_repeat_purchase_tier_limits.sql`.
2. Append `docs/payments/drafts/settlement-fulfillment.sql` after the funding source and after any reviewed checkout replacement wrapper, then regenerate the runtime migration through the existing assembler. Do not hand-edit the generated artifact.
3. Wrapper composition was agreed with the checkout-replacement worker. Replacement installs first. This patch renames that outer cart function to `dvnt_settlement.paid_cart_before_settlement_fulfillment`; its distinct inner `public.complete_paid_cart_atomic_without_replacement` remains unchanged. The fulfillment wrapper observes the final successful result and preserves replacement's transaction rollback. Only this patch wraps the single-tier paid issuer.
4. No HTTP endpoint signature changes are required. The engine adds the fixed fulfillment failure code; cart checkout adds immutable line unit prices. The shared hosted-session issuer imports the new read-only preparation adapter. Runtime-budget endpoint changes are independent; retain both processing reason codes when composing sources.

### Shared fixture upgrades

`scripts/fixtures/settlement/issuance.cjs` exports reusable helpers:

- `installIssuers(pg)`: after the narrow baseline schema, before the assembled settlement artifact, install the additional synthetic schema and the **real** canonical SQL routines.
- `issuerSql()`: return those real routines for custom/native assembly.
- `fixtureTier`: a valid UUID to replace placeholder `fixture-tier` / `fixture` selections in successful checkout fixtures.
- `issuePaidOrder(pg, orderId)`: after a fixture explicitly binds its simulated successful PaymentIntent, create the synthetic capacity/hold/signed-row inputs and invoke the **real** paid issuer. It does not write a receipt, mark the order paid, accept an unknown link, or bypass failed issuance. Cart fixtures use `fulfillment.cjs` for exact cart/add-on setup.

Adapt base engine setup, assembled-migration setup and native `Database.paid` before enabling the source in their common artifact. Successful fixtures must explicitly issue before verification. Unlinked/failed/partial fixtures must remain unfulfilled; update their success assertions only after explicit simulated canonical recovery, not with automatic issuance inside `settlement_verify_source` or a mocked RPC. Funding fixtures that introduce a second order must issue that order before enrollment. Hosted-tax fixtures must run `session-adapter.cjs` against the actual preparation adapter and SQL RPC before issuing; do not manually prime order totals, which would conceal the production ordering defect. Existing standalone foundation tests can stay intentionally scoped, but are not evidence of this gate.

The focused fulfillment fixture already loads the full generated artifact plus this draft if not yet assembled. Its `installGate=false` option is only a test-only pre-gate historical simulation, used to prove that existing bare paid/enrolled rows do not acquire proof or become eligible for new reservations.

## Verification and remaining gates

- Real SQL plus fake provider: all four rails; failed capacity → untouched recoverable status → canonical recovery → promoter-first transfer exactly once; exact ticket/cart/add-on mismatch and atomic rollback; service/client spoof denials; immutable receipt replay; terminal/refund/dispute handling; transferred/redeemed lifecycle states; actual worker endpoint attention; hosted tax and atomic assembled installation.
- Existing engine, worker endpoint and baseline migration regression suites are run separately. The baseline generated artifact still lacks this follow-up and must not be mistaken for rollout-ready integration.
- `scripts/test-settlement-fulfillment-concurrency.py` defines 34 native PostgreSQL races, observing `pg_blocking_pids` before releasing the winner: issuer commit/rollback, failed inventory, source-first no-inversion, concurrent duplicate issuance and dispute-before-reservation, for every rail, plus ten hosted tax preparation/rollback/issuer-first/conflicting-capture/refund races. Run in the disposable GitHub runner with `python3 scripts/test-settlement-fulfillment-concurrency.py --disposable-ci-postgres` after starting PostgreSQL. All 34 scenarios were also executed locally against isolated PostgreSQL 17.6 on loopback using a node-postgres transport for the same checked-in scenario functions. This is real server concurrency with observed blockers, not PGlite or mock execution. The local transport is not the CI psql/createdb path; exact integrated CI remains required.
- Required before any rollout: independent review, integrated exact-tree CI including the native races, combined replacement/fulfillment wrapper tests if replacement is included, provider sandbox end-to-end evidence, schema/migration review and explicit operational configuration. Real Stripe access remains live-only and no provider writes were attempted.

### Recorded local checks

- Actual session adapter + paid issuer + webhook + both focused fulfillment suites: **96/96 passed**. The two focused fulfillment suites account for **33 groups**, including nested invalid-provider and historical-binding matrices. Tax success is established by the production adapter, never manual order priming. A final **14/14** hosted-focused rerun additionally starts both hosted rails with the PaymentIntent still unknown, as in ordinary Session creation, and proves verified binding before issuance.
- Earlier targeted engine + endpoint + baseline migration + then-current fulfillment suite: **57/57 passed**. The baseline generated artifact remains unchanged and lacks the new source.
- Combined replacement/fulfillment checker against the final source hash: **8/8 passed**. This establishes wrapper compatibility, not provider sandbox or complete integrated readiness.
- Native PostgreSQL 17.6: **24/24 actual-issuer races and 10/10 hosted tax ordering races passed** in disposable databases through the local node-postgres transport. The source scenarios are checked in; final assembled CI must still exercise its normal psql path.
- Strict TypeScript check of `_shared/settlement-engine.ts` and its imported funding code: passed. Deno check of the new `_shared/settlement-hosted-issuance.ts`: passed. These are not a full monorepo typecheck.
- `node scripts/build-settlement-migration.mjs --check`: passed for the unchanged baseline generated artifact.
- `node scripts/verify-edge-functions.mjs`: passed, 189 shipped functions, no unpinned or floating imports.
- Python compilation and `git diff --check`: passed.

The final fixture replays the latest `complete_paid_cart_atomic` definition from `20261031142216_repeat_purchase_tier_limits.sql`, including its real buyer-limit helper and category trigger. The older 20261029 definition is installed first as migration history, then replaced exactly as production history does. A dedicated cap-failure test verifies this version-specific behavior.
