# Runbook — legacy payouts-release: do not re-run

**Money-moving legacy aggregate endpoint, not a payout-recovery tool.** Do not
invoke it manually, populate historical release dates, enable a cron job, widen
status constraints, or clear a hold to get commissions out. It can send an
organizer transfer as well as promoter transfers. Historical destination charges
already allocated proceeds to organizers; rerunning aggregate settlement can pay
an organizer twice. Organizer allocations are not platform-available funds.

## Verified incident, November 19, 2026

- The five commission-bearing events have no `payout_release_at`. The deployed
  endpoint selects only pending events with a non-null, due release date.
- No payout job was present in Supabase `cron.job`. External scheduling has NOT
  been ruled out; a comment saying “hourly” is not evidence of a working schedule.
- `settlement_claim_legacy_event` writes `processing`, which the deployed event
  constraint rejects. This fails atomically before transfers. Do not relax that
  constraint as a standalone repair.
- The NYC event has an external-payment quarantine. Preserve its exact covered
  obligations and event hold. A completed outside receipt is not a Stripe ID.
- No matching payout heartbeat was recorded. The old watchdog does not alert
  on an absent row, so silence is not proof of healthy execution.

## Why retries are not guaranteed safe

Deterministic Stripe idempotency keys and an overlap lock do not prove exactly-once
settlement. The old key depends on a mutable payout window; ledger writes can fail
after provider success. Organizer math uses remaining unsettled promoter rows, so
retrying after partial success can overstate organizer entitlement. An unknown
provider outcome must remain uncertain until reconciled. Never generate a new
operation/key because time passed or a search returned no result.

## Safe diagnosis (read-only)

Use authorized SELECT-only inspection of event dates/status, exact ledger rows,
quarantines, receipts, account bindings, cron inventory, and actual constraints.
Independently reconcile exhaustive provider history in the correct platform and
connected-account context. Pending ledger entries do not prove nonpayment; bank
payouts do not prove a particular promoter commission was settled.

`scripts/payments/promoter-preflight.mjs` assesses a supplied snapshot offline. It
has no database/provider access and always returns `executionAllowed: false`.
Explicit event/promoter scope, fresh evidence, holds, prior receipts, uncertain
provider outcomes and malformed economics are checked. Unknowns remain blockers.
It is a review aid, not a dry-run of the execution worker. In draft PR #286,
`execute:false` still writes reconciliation state; do not run it on production for
a read-only check. PR #288 is stacked test work, not a production payout patch.

Run offline tests: `node --test scripts/test-promoter-preflight.mjs`.

## Recovery contract before any separately authorized payment

1. Bind an immutable operation to exact ledger/order IDs, amount, currency,
   beneficiary, provider account/mode and source evidence. Exclude reported or
   settled external obligations and held/disputed/canceled orders.
2. Separate per-promoter claims from organizer settlement. No organizer transfer
   is permitted in historical commission recovery. Verify destination-charge
   funding and any host-side rail; metadata alone cannot move host funds back.
3. Reserve exact rows atomically once. Use a stable operation key independent of
   mutable dates. Provider-success/write-failure and timeout enter durable
   reconciliation states. No fresh transfer until exact provider evidence resolves
   the previous outcome. Preserve receipts and claim history.
4. Prove actual recipient capability/ownership, available funding, permissions,
   schema compatibility, and crash/concurrency recovery using isolated fixtures.
   Review #286/#288 against the current base rather than merging their whole stack
   as an emergency shortcut. No live migration or execution is authorized here.
5. Existing overdue amounts need separate exact payment review and approval, not
   retrospective auto-release. Preserve duplicate-payment controls throughout.

## Future policy: two business days

The requested future promoter policy is **two business days after the event's
local end**, not five. The offline `previewTwoBusinessDays` helper accepts a
reviewed local end date, timezone and holiday calendar with explicit coverage.
It skips weekends and supplied holidays, refuses missing coverage and returns a
local date only. It does not guess a holiday jurisdiction, release time, bank
arrival date or convert UTC into local dates. Those must be reviewed before rollout.
It never backfills old events, activates a schedule or overrides holds, source
reconciliation, receipts, funding or recipient capability. The policy preview is
not implemented production payment scheduling. Actual transfer execution remains
blocked until the recovery contract above is implemented and proved.

Use `evaluateFuturePromoterSchedule` to hand a reviewed per-event schedule
to a future scheduler. It derives the event's local end date from the verified
timestamp and IANA zone, checks an explicit start-of-policy cutoff and holiday
coverage, and returns `due_for_checks` on or after the second local business
day. That label is calendar eligibility only. It cannot authorize transfers
or specify when money arrives at the recipient's bank. Events that started
before the cutoff are excluded, as are nonpending events and events with
unresolved dispute checks.

Production wiring must source a verified event zone and end time, use the
reviewed calendar, and call a separately verified promoter-first worker, not
the legacy aggregate endpoint. Keep claims, hold checks, historical receipt
reconciliation and provider idempotency at the actual payment boundary.
