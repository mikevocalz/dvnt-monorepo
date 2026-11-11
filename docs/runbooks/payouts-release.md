# Runbook — payouts-release

**Money-moving function. Do not enable a schedule or invoke it to diagnose a payout.**

## Current safety contract

- The event claim is an atomic compare-and-set from `pending` to `on_hold`, using the existing schema. Only the winning request proceeds. The global TTL job lock is an optimization, not a financial lock.
- A crash, timeout, Stripe uncertainty, database error, dispute, missing account, unknown funding model, or held promoter share leaves the event held. There is no automatic reset to `pending`.
- Nonzero orders must explicitly use `separate_charges_and_transfers` and USD. Unknown/NULL, destination-funded, or mixed events fail closed before either promoter or organizer transfers. The aggregate financial summary cannot safely isolate destination-funded money.
- Any previous payout record or settled promoter ledger row requires reconciliation. This prevents retrying with already-paid promoter deductions omitted.
- Reads must succeed and bounded order/ledger reads must be complete. Invalid amounts and promoter cuts exceeding the event net block settlement. Ledger writes are checked and limited to the rows read.
- Successful Stripe transfers are not bank payouts. Held promoter money is not reported as a fully released event.
- Any per-event error/hold returns HTTP 503, so the heartbeat does not report a successful release run.

## Reconciliation before retry

Never blindly reset a held event, change its payout window, clear transfer IDs, or rely on an expired Stripe idempotency key. The key is short-lived deduplication, not a durable financial ledger. A transfer may have succeeded even if its HTTP response or the subsequent database write failed.

Read the event's orders, actual Stripe PaymentIntents/charges/destination transfers and reversals, promoter entries, payout rows, and Stripe transfers for that event/window. Resolve all uncertain outcomes before planning any new movement. A held event can represent an in-flight worker: ensure no worker is still running before any administrative change.

## Rollout prerequisites, not implemented by this safety patch

1. Reconcile historical charge models against Stripe; never infer separate funding from NULL. Historical destination-funded commissions require an explicit funding decision: recover the commission from the existing organizer destination transfer (per order), or approve a separately funded promoter-only transfer. Do not issue another organizer transfer.
2. Implement a durable per-order settlement/reservation ledger with immutable amounts, source charge, recipient, currency, transfer ID, and reconciliation state. Use source transactions and enforce the total allocation bound. Refund/dispute changes must coordinate with those reservations. Event-wide aggregate settlement is not a substitute.
3. Add a reconciled resume path for partial settlements and held promoter accounts. Existing paid entries must remain part of organizer deductions. Blind event requeue is forbidden.
4. Track connected-account payout webhooks separately from transfers: pending, paid, failed/canceled bank payouts must not be inferred from a transfer response.
5. Validate end-to-end in an isolated Stripe sandbox before any deployment or scheduler activation. This patch neither migrates schema nor enables any schedule.
6. Verify scheduler ownership, eligibility dates and alert delivery separately. The existing heartbeat checks only cover recorded jobs; an absent heartbeat does not prove a job runs.

## Verification (offline only)

`node --test apps/mobile/supabase/functions/payouts-release/safety.test.cjs`

Tests use a mocked database/Stripe transport, including concurrent claims and uncertain responses. They never call Stripe or the deployed function. PostgreSQL concurrency, actual Stripe behavior and production deployment are not verified by these tests.
