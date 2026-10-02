# Event and ticket safety audit — September 19, 2026

## Production rollout completed with Mike's approval

Both corrective migrations were applied through psql in separate transactions,
each recording its version and SQL in the migration ledger. The original three
migrations were not replayed, and migration-history drift was not repaired.

Active function versions verified after deployment:

| Function | Previous | Deployed |
|---|---:|---:|
| stripe-webhook | 62 | 63 |
| reconcile-orders | 49 | 50 |
| ticket-checkout | 49 | 50 |
| create-payment-intent | 53 | 54 |
| cart-checkout | 26 | 27 |
| manage-promoters | 4 | 5 |
| door-sell | 1 | 2 |

All seven retain `verify_jwt=false` with their own auth/signature checks.
Unauthenticated POST probes returned 401 for six functions and 400
`Invalid signature` for the webhook. `ticket-scan` v45, `promoter-connect` v1,
and `promoter-self` v1 were not redeployed.

Read-only before/after verification, including after all deployments:

- All 316 ticket rows: identical content fingerprint.
- All 28 event rows: identical content fingerprint.
- All 322 order rows: identical content fingerprint; zero payment-pending orders.
- Event 79: 116 tickets (112 active, 1 scanned, 2 refunded, 1 void), unchanged.
  No missing QR tokens/payloads and no duplicate QR tokens.
- Zero promoter rows currently exist, so the discount correction updated zero
  rows. Legacy creation now defaults to attribution-only; explicitly configured
  future customer discounts are still supported.
- New free-sale RPC exists; anon cannot execute it, service_role can.
- Yesterday's non-partial ticket uniqueness index, attendee-name RPC, transfer
  expiry RPC and active transfer-expiry cron job remain present.

Private backup and aggregate evidence:
`~/.codex/private/dvnt-rollout-20260919/` (directory mode 0700, files 0600).
No paid/free sales, ticket scans, refunds, webhook replays, or reconciliation
sweeps were executed as production tests. Sandbox Stripe and authenticated
staff/outsider flow verification remain outstanding.

**Separate finding:** the live cron list contains seven jobs and no scheduled
reconciler job, contrary to the earlier handoff's claim of eight including
`reconcile-orders-every-15min`. This rollout did not modify cron. Restoring a
job was outside the approved two-migration/seven-function deployment.

## Follow-up corrections

Mike confirmed that existing promoter codes must remain attribution-only.
The corrections below are deployed. The original audit at the end describes
the previous deployment, not the corrected production bundles.

- Forward migration `20260919180000` clears current customer discounts only.
  It retains promoter commission rates, orders, attribution snapshots and tickets.
  Legacy promoter-management requests now default customer discounts to zero.
- Hosted checkout charges the exact subtotal after both discounts, splitting
  remainder cents across ticket lines. Fee metadata and order totals agree.
  It now uses the existing shared atomic hold RPC, expiring an unallocated
  Stripe session when inventory is unavailable.
- Integration testing discovered another bug: the promoter validator and
  snapshot fallback multiplied the already-computed subtotal by quantity again.
  Fixed those callers; previously locked commission amounts remain authoritative.
- New `door_free_sale_atomic` RPC (`20260919181000`) commits the free order,
  guest tickets, inventory conversion and timeline together under the tier lock.
  Free quotes bypass paid fees; issuance fails closed if the RPC is unavailable.
  Free guest email uses the existing mail helper after commit; mail failure
  does not roll back or report an uncompleted sale.
- The cart webhook now passes the same no-refund option as yesterday's
  reconciler. Allocation rejection returns HTTP 500 for Stripe retry and leaves
  the delivery unprocessed; no automatic refund or false success is recorded.
  Paid-but-unissued orders still require recovery if inventory cannot be allocated.

Verification: 20 mocked edge-function regressions cover all three checkout
rails, exact rounding, attribution-only legacy codes, legacy management clients,
zero-total door paths, missing/failed allocation, and signed webhook failures.
The disposable PostgreSQL test covers free/free/online last-seat contention,
cart reservations, transaction rollback, RPC permissions, and unchanged ticket
and order rows during the promoter correction. Main suite: 692 Node + 83
observability tests. Seven affected edge functions pass Deno typechecking.
Existing issuance-grant warnings from the baseline remain unresolved.

### Rollout scope

Apply only the two NEW migration files, each in a transaction with its migration
ledger insert. Record versions `20260919180000` and `20260919181000` only after
their SQL succeeds; skip any already-recorded version. Export existing promoter
discount settings before the correction. Do not replay the original three
migrations, run `db push`, or reconcile the unrelated migration-history drift.
Confirm `ticket_hold_create_atomic(uuid,integer,text,text,text,integer,text)`
exists before applying the free-sale RPC.

Then redeploy these seven bundles, which include their shared dependencies:

```sh
# Run from apps/mobile; project is dvnt-social.
npx supabase functions deploy stripe-webhook --project-ref npfjanxturvmjyevoyfo --no-verify-jwt
npx supabase functions deploy reconcile-orders --project-ref npfjanxturvmjyevoyfo --no-verify-jwt
npx supabase functions deploy ticket-checkout --project-ref npfjanxturvmjyevoyfo --no-verify-jwt
npx supabase functions deploy create-payment-intent --project-ref npfjanxturvmjyevoyfo --no-verify-jwt
npx supabase functions deploy cart-checkout --project-ref npfjanxturvmjyevoyfo --no-verify-jwt
npx supabase functions deploy manage-promoters --project-ref npfjanxturvmjyevoyfo --no-verify-jwt
npx supabase functions deploy door-sell --project-ref npfjanxturvmjyevoyfo --no-verify-jwt
```

`reconcile-orders` source and yesterday's recovery guard were not changed; its
bundle needs the corrected shared snapshot computation. Its cron-secret auth
requires `--no-verify-jwt`. Other functions retain their own session/signature
verification. No changes to `ticket-scan`, `promoter-connect`, `promoter-self`,
the original migration files, ticket cache/ownership/transfer/name logic, or
scanner UI are included in this correction.

Production follow-up remains: authenticated staff/outsider probes and Stripe
sandbox payment evidence. Read-only ticket/order/QR invariants passed. Do not use real
event sales, refunds, payment replays, or a reconciliation sweep as test data.

## Original baseline audit

Verdict: **not cleared as having no effect on existing events/ticket sales**.
This is a local source and regression-test audit of `046c9db..5f9f455`,
also compared with yesterday's final commit `bc00d16`. It does not certify
the current production database, deployed bundle contents, Stripe payments,
or physical scanner behavior. No deployment, database write, refund, replay,
or migration repair was performed during this audit.

## Yesterday's fixes retained

All 21 distinct files touched by the selected September 18 fixes below are
byte-for-byte unchanged from `046c9db` to `5f9f455`:

- `bc00d16`: ticket/add-on cache isolation.
- `736dfc0`, `c145d97`: persisted-session identity backfill and ticket ownership.
- `96a2735`, `9cef457`: transfer handover and expiry.
- `e1db885`: attendee names.
- `1390fae`: reconciler no-refund guard and shared cart issuance.
- `3dfbe47`: paid issuance grants/non-partial unique index migration.
- `61c9187`: refusal to check in refunded tickets.

The ticket-detail change after yesterday moves hooks above early returns
(`046c9db`), preserving the blank-screen fix. This is not a claim that every
file from yesterday is unchanged: scanner/staff UI and shared payment paths
were intentionally changed by the payments branch.

The only `ticket-scan` change in the audited payments range removes
`purchase_amount_cents` from the returned ticket selection. Its validation
and check-in logic is unchanged in that range.

## Blockers and material effects

1. **Existing promoter codes change future checkout prices.**
   `20260919120000_promoter_code_v2.sql` explicitly updates existing
   `event_promoters.customer_discount_bps` to `rev_share_bps` for positive
   rates. Previously these were attribution-only codes. A pre-existing
   10% revenue-share code now grants a 10% customer discount. This is an
   intentional product change in the migration, not evidence of corrupted
   existing tickets, but it contradicts an unconditional "no effect" claim.
   The three migrations do not directly update/delete existing events or
   tickets. The promoter migration must not be blindly replayed: its UPDATE
   can overwrite subsequently edited split rates.

2. **Hosted checkout ignores ordinary promo discounts in its paid amount.**
   `ticket-checkout/index.ts` calculates `effectiveSubtotal`, then replaces
   it with `ticketUnitAmount * quantity` for fee calculation. The unit amount
   includes only promoter discounts, not `promo_code` discounts. Stripe
   receives that unit amount and no corresponding coupon. Evaluating the
   actual pricing block and shared fee calculator locally: a $50 ticket with
   a 10% ordinary promo produces $52.25 before tax, versus $47.13 when fees
   are computed on the discounted $45 subtotal. The prior version already
   sent an undiscounted ticket line for ordinary promos; this deployment
   additionally regresses the fee/order subtotal from discounted to full
   price. Promoter per-unit rounding also drifts from its locked snapshot:
   three $3.33 tickets with a 15% discount give an exact $8.50 subtotal but
   $8.49 in the Stripe lines. Correct the actual line-item total and fee/order
   basis together, with mocked checkout integration coverage.

3. **Free door sales currently fail; their allocation also needs repair.**
   `door-sell/index.ts` calls `computeFeesWithMode(0, quantity, fee_mode)`
   before the free branch. The real helper throws for negative organizer
   transfer in both pass and absorb mode; verified locally for one ticket.
   Thus even the free quote fails. The subsequent free branch directly
   inserts tickets and writes a read-modify-write sold count, with no atomic
   reservation or sold-out check. That inventory defect is currently masked
   by the fee error. Do not fix only the fee error: secure allocation and
   concurrent free/paid/online coverage must land together. The existing
   hold-RPC race test does not execute this free branch.

4. **The historical webhook refund risk remains.**
   Yesterday's reconciler still passes `refundOnAllocationFailure: false`.
   `stripe-webhook` still calls the shared cart handler without that option,
   whose default permits refunds on rejected allocation. This is unchanged
   behavior, not a regression introduced by the door branch. The handoff's
   old-hold retry risk remains unresolved; do not replay payments as a smoke
   test or treat a 401 response as payment/issuance validation.

## Verification

- `pnpm test`: 690 Node tests and 83 observability tests passed.
- `pnpm test:community`: 312 passed (overlaps the main suite).
- `pnpm verify:routes`: 140 routes / 193 files passed.
- `pnpm --filter web typecheck`: passed.
- `pnpm --filter mobile exec tsc --noEmit`: passed using the mobile package's
  compiler. The root compiler rejects mobile's `ignoreDeprecations` setting;
  it is not the compiler used for this passing check.
- `pnpm verify:issuance`: still reports the 11 previously documented
  missing-service-role-grant violations and eight unverifiable indexes.
  This is a static migration-history check, not a production grant query.
- Local execution of the production fee helper and hosted-checkout pricing
  block reproduced the free-price exception and discount discrepancies above.

Production ticket counts/statuses, QR uniqueness, payment-pending orders,
webhook delivery outcomes and real authenticated access probes have not been
checked in this audit. Passing local suites does not establish those facts.

## Safe follow-up

Preserve yesterday's fixes and the applied migration history. Repair the
checkout and free-door blockers in narrowly scoped changes; explicitly decide
whether existing promoter codes should retain their old pricing behavior.
Use forward migrations for any approved database correction, never an
automatic history repair or reapplication of these three files. Verify the
result against isolated fixtures before a production rollout.
