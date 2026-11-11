# Existing v1 recipient compatibility: isolated test-mode draft

This follow-up is separate from the reviewed combined settlement baseline. It changes no SQL, provider object, account setting, deployment flag, credential, schedule or live data. It does not establish live legacy support or end-to-end provider execution.

## Boundary

The worker first retrieves the exact SQL-selected candidate for the frozen actor with Accounts v2. Its existing active `configuration.recipient.capabilities.stripe_balance.stripe_transfers` and frozen ownership checks are unchanged. Successful v2 responses, including missing or restricted capability, never select v1.

Only a typed HTTP 400 error with the exact code `v1_account_instead_of_v2_account` from that v2 retrieve selects one GET per verification attempt `/v1/accounts/{same_account}`. There is no list discovery, account substitution, new account creation, transport retry or metadata repair. Network/timeouts, HTTP 401/403/404/429/5xx, generic errors, message text alone, malformed JSON and untyped lookalikes do not authorize the compatibility path. The HTTP adapter retains only a bounded status and this allowlisted code, not provider messages or bodies.

A legacy response is independently checked. It is never transformed into an active v2 configuration. The initial support boundary is deliberately narrower than Stripe's general APIs:

- Exact account object and destination ID, not a list or deleted object.
- Exact frozen organizer or promoter actor metadata. A frozen promoter without a user binding requires the frozen promoter ID and no inferred current user. Conflicting host/user metadata is rejected. No current roster identity is substituted.
- Explicit `capabilities.transfers === 'active'`; `charges_enabled` is not readiness proof.
- US account, USD default currency and USD settlement. Other currency/country combinations need separate review.
- Explicit account requirements: null disabled reason, and present, empty currently-due, past-due, pending-verification and error arrays. Absent is not null or empty.
- Explicit payouts enabled, details submitted and platform controller evidence. Complete account-scoped external-account list with one default USD US bank, exact owning account, available standard payout method and status `new`. Unknown, truncated, conflicting, missing or failed bank evidence holds. Stripe documents `new` as the normal nonfailed external-payout-bank status; this is not bank ownership verification or successful payout proof. The customer-bank `validated` and `verified` statuses are not accepted here.
- Fresh GET `/v1/balance` with `Stripe-Account` set to that exact destination, an explicit Balance object, present available/pending arrays and `livemode === false`. Accounts v1 has no documented livemode attribute. Connected mode must also match the reviewed platform funding policy immediately before reservation. Missing or live mode rejects.

The proof discriminator is `legacy_v1_test`, not `v2`. All legacy proof failures classify as the existing `recipient_restricted` attention reason; the pure helper additionally has safe fixed identity/ownership/capability/requirements/bank/currency/mode limitations. No account or bank details are persisted in those errors. The existing worker may revisit a held order on a later processing turn; each verification starts with v2 again and a failed read is not retried inside the helper. Raw provider read errors remain generic verification attention. Organizer release still waits for the promoter obligation, and a transfer is still not a bank deposit.

## Evidence and missing verification

An independently sanitized sandbox **list** observation had active transfers, payouts enabled, US/USD and controller fields. It had only fixture metadata and no frozen DVNT owner binding; requirements and account livemode fields were absent. It is rejected as unbound. This observation is not an exact GET response, complete bank proof, or evidence that the synthetic successful fixture matches an actual existing account. No real account ID, PII or secret is included in tests.

Before enabling this path even for a repository-driven sandbox pilot, obtain an authorized exact GET with valid frozen actor metadata and complete requirements/bank fields, verify the exact error envelope/status and connected balance context on the configured API version, and exercise real worker transfer, lost reply, recovery, reversal and bank reconciliation. Do not fill gaps by adding ownership metadata to an unrelated provider account. Newly created v1 accounts may take time to become v2-readable; that documented delay is not an explanation for an older account's rejection or a reason to create more accounts.

A false livemode value proves non-live mode, not isolation from the shared test-mode sandbox. Selecting and verifying a dedicated sandbox remains an independent operational gate.

Live legacy support remains failclosed regardless of other execution flags. It requires independent provider contract/evidence review and a separately reviewed change, or a valid v2 readiness response. The sandbox check is not permission to move funds, enable a schedule, change settings or deploy. Existing deployment, cohort, funding, canonical fulfillment and all other runtime gates still apply.

## Sources reviewed

- https://docs.stripe.com/connect/accounts-v2/migrate-integration documents interoperability and the new-v1-account delay. It does not prescribe an exact-error fallback.
- https://docs.stripe.com/connect/accounts-v2 maps recipient stripe transfers to the v1 transfers capability. This mapping is not permission to treat payouts-enabled alone as v2 proof.
- https://docs.stripe.com/api/accounts/retrieve and https://docs.stripe.com/api/accounts/object define exact retrieval and the v1 fields.
- https://docs.stripe.com/api/external_account_bank_accounts/object defines the external bank account owner, currency, default flag, available payout methods and external-only statuses.
- https://docs.stripe.com/connect/authentication documents connected-account context for GET `/v1/balance`.
- https://docs.stripe.com/api/balance/balance_object defines Balance.livemode.

The repository's pinned API version is preserved. Current docs can describe a newer version; exact configured-version provider evidence is still required.

## Reproduce offline verification

Use the isolated dependencies and serial execution described in `settlement-runtime-validation.md`.

- `node --test --test-concurrency=1 scripts/test-settlement-recipient.cjs scripts/test-settlement-recipient-sql.cjs`
- `node --test --test-concurrency=1 scripts/test-settlement-engine.cjs scripts/test-settlement-endpoint.cjs scripts/test-settlement-funding.cjs scripts/test-settlement-fulfillment.cjs`
- `tsc --noEmit --strict --allowImportingTsExtensions --target ES2022 --module esnext apps/mobile/supabase/functions/_shared/settlement-engine.ts`
- `node scripts/build-settlement-migration.mjs --check`
- `node scripts/verify-edge-functions.mjs`
- `node scripts/verify-no-live-identifiers.mjs`

The composed tests install the unchanged final migration, invoke real canonical issuers, then run the actual HTTP adapter, funding audit and reservation RPC. No receipt is seeded and no reserve or fulfillment wrapper is bypassed. Unit coverage includes exact-error selection, ownership/capability/requirements/bank/currency/mode failures, unchanged v2 behavior and adapter error redaction. Composed coverage includes all four checkout rails, promoter-before-organizer ordering, no-dispatch negatives, replay, funding/fulfillment barriers and account-link changes after provider proof.

These are synthetic offline checks, not a production schema check, full monorepo test/build, provider-backed end-to-end result, or deployment approval. Final local test results are recorded by the isolated patch commit's delivery report.

Local validation on 2026-11-11: 109/109 dedicated cases (88 unit/actual-HTTP-adapter and 21 full-SQL/canonical-issuer worker cases), plus 154/154 existing engine, endpoint, funding, fulfillment, hosted-fulfillment, checkout-liveness and webhook-link cases. All ran serially with no failures or skips. Strict TypeScript and Deno checks of the engine/helper, local worker bundling with remote dependencies externalized, generated migration equality, edge-function static verification and the live-identifier guard passed. The v2 verifier was also compared byte-for-byte with the baseline. SQL sources and the generated migration are unchanged. Native PostgreSQL concurrency and the full monorepo suite were not rerun for this isolated adapter patch.

## Stacked draft dependency

This isolated patch is replayed on the exact reviewed #286 head `ac68e186864b22bc7786454d14ece6730caa8641` (tree `e8e70c3136a980ebf1237da5cf52944d7cc120cd`) and targets its `fix/settlement-runtime-integrated` branch as a separate draft. It does not alter that base branch, enable any flag or establish live legacy support. #286 remains a disabled draft with its own operational and provider gates. If its base advances, recheck composition and tests before merging any stack member. Neither draft is independently approved for production.
