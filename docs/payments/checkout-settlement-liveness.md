# Checkout observation and settlement queue liveness

Offline draft only. These changes do not activate a worker, schedule, account setting, migration or payment. The monitored 90-minute tolerance is not a business release window. `execute=false` still reconciles/enrolls verified source records; it is not a production read-only diagnostic.

## Operational outcome, not an amount owed

A failed checkout link/source reconciliation records the first `outcome_unknown_since` observation. Later failures preserve that first timestamp. Health exposes `oldest_checkout_outcome_unknown_at` only for an unenrolled checkout whose effective event release is due, using the later of its first observation, frozen release and current event release. The watchdog issues `checkout_outcome_unknown` after 90 minutes even when the worker completed recently or execution has been paused. A future release or a correctly known nonpaid checkout does not cause this alert.

The service-only `settlement_checkout_observation(order_id, outcome, intent, session)` accepts `unknown` or a fully validated `nonpaid` observation. Nonpaid proof must be a freshly retrieved, exactly bound PaymentIntent with matching order/model/currency/economics, zero amount received, no latest charge, and no destination/application-fee/on-behalf-of routing. Hosted proof also requires the exact bound unpaid session, matching intent, tax and totals. Null, missing, malformed, contradictory, partial-money and wrong-object evidence fail closed. A non-null latest charge is conservatively unknown; this draft does not infer safety from a failed or uncaptured charge object.

Only an exactly proved canceled intent with zero received and no charge can retire an unencumbered attempt from automatic polling. A hosted rail additionally requires its exact session to be expired and unpaid. Paid/enrolled/previously source-verified orders cannot be retired. Holds prevent retirement and are never cleared. Requires-payment-method, processing, expired session alone, elapsed time, missing list results and retry exhaustion never retire an attempt. Observation and polling fields do not change any liability, allocation, reservation, external receipt, recovery evidence or funding-source credit.

Retirement is **polling only**, not a completed canceled-checkout recovery or permission to charge again. The existing prepared-checkout deduplication/remount guard still rejects a prior `payment_pending` attempt even when `retired_at` is set. A replacement-attempt flow needs separate review; this slice does not change payment creation, idempotency, or its authorization.

## Fair automatic selection

At a batch limit of 100, a nonempty eligible cohort receives at least:

- 25 slots for reserved, uncertain or recovery-required deliveries, including future-rescheduled or held events.
- 45 slots for enrolled, due held allocations.
- 15 slots for due unenrolled checkouts with a paid database status or an unresolved-outcome observation.
- 15 slots for other eligible pending reconciliation attempts.

Unused capacity spills into the other cohorts, urgent first. The returned JSON preserves that selected order for sequential dispatch, so older pending spillovers cannot move ahead of new due or recovery work. Each cohort rotates by least-recently-checked order. Limits of 1, 2 or 3 rotate guaranteed cohorts with a separate private scheduling cursor, without acquiring the financial controls mutex. The result contains each order at most once. Future held allocations are deferred; automatic scheduling never changes the authoritative release gate.

Unknown outcomes retry with exponential delays capped at one hour. Known awaiting attempts are capped at six hours while their event is far in the future and at one hour once release is due; a delay cannot extend beyond one hour after the effective release. Selection reserves a five-minute retry interval for unenrolled attempts if a worker stops before recording its observation. No delay expires a financial unknown or releases reserved funds. Quota fairness covers the selected batch. If a handler consistently stops before consuming it, selection alone cannot guarantee every cohort executes; use measured worker cadence, batch size and execution budget, and monitor incomplete runs. Limits of 1/2/3 retain rotating selection fairness when callers deliberately request small batches. These bounds are retry eligibility, not completion promises: actual latency also depends on worker cadence, eligible backlog, provider availability and execution limits. Rollout must measure those operational bounds.

`settlement_order(order_id)` bypasses automatic retirement, backoff and release filters so refund/recovery/evidence reconciliation can always retrieve the attempted order. Verified webhook linkage, actual order status/link changes, and verified source enrollment wake scheduling. A wake does not clear the unknown observation or a hold. Only validated nonpaid or successful source verification clears the observation; normal source/funding/refund/external-settlement gates remain authoritative.

## Offline evidence

Run serially with the isolated dependency directory in `NODE_PATH`:

- `node --test --test-concurrency=1 scripts/test-settlement-checkout-liveness.cjs scripts/test-settlement-runtime.cjs scripts/test-settlement-endpoint.cjs scripts/test-settlement-webhook-link.cjs apps/mobile/supabase/functions/_shared/settlement-readiness.test.cjs`
- Deno strict checks for settlement-engine and settlement-readiness using the repository's normal shared-module options.

The liveness suite bulk-seeds 5,000 synthetic abandoned attempts and 5,000 future held orders, then proves an actual newly enrolled due order is selected in the first batch. It also covers sustained nonempty cohorts, limits 1/2/3, spillover, no duplicates, exact cancellation proof negatives, hosted expiry binding, paused/rescheduled recovery, hold preservation, webhook wakeup, and service-only ACLs under inherited public-schema default grants. Real worker-handler fixtures verify that a provider-paid but unbound DB-pending failure stays visible despite a healthy worker observation and that invalid nonpaid evidence cannot silently clear it.

The engine suite is imported by endpoint/webhook/liveness harnesses, so reported command totals repeat its cases. Regenerate the atomic migration and rerun full artifact/native concurrency/CI checks on the final exact commit. These local fixtures do not prove provider sandbox behavior or live release readiness.
