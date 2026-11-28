# Draft worker admission budgets

The worker admits provider requests only before the configured run budget minus
35 seconds. Each admitted HTTP request keeps its existing 30-second transport
timeout. The last five seconds are intended for persistence and response, not a
guarantee that the database or host will finish within that interval. There is
no deadline race that declares a dispatched mutation failed. Lost responses and
post-dispatch persistence failures retain reservations and reconcile first.

`SETTLEMENT_RUN_BUDGET_MS` is mandatory and accepts integers from 90000 to
600000. Missing or invalid values fail before any provider request or financial
RPC. Tests explicitly use 120000; production has no implicit default. These bounds are validation limits, **not verified
host capabilities**. This checkout does not specify the deployed Supabase plan,
host wall-clock limit, database timeouts, or network tail-latency distribution.
Before rollout, measure those constraints and explicitly set a fitting budget.
Do not enable execution based on this draft or its fake-clock tests alone.

A durable database phase cursor advances before work begins. Each turn claims
only one refund, recovery, bank proof, settlement order, or replacement cleanup, and existing durable
candidate ordering advances within each phase. Cleanup is a fifth phase, separately gated off by default, with admission
checked before its durable cancellation claim. At most 100 turns run per
invocation. No batch of 100 candidates is leased and silently abandoned. A kill
or failed phase cannot pin later invocations to refunds. The cursor is not a
financial lock: existing allocation claims remain the dispatch authority.

Ordinary between-item exhaustion returns `budget_exhausted`. In-item exhaustion
in every phase persists a bounded phase/work identity in runtime attention,
exposes `runtime_budget_blocked` in health, and raises a distinct readiness issue.
The adapter counts rejected admissions even when a helper catches its exception.
Bank, refund and recovery results contribute to checked/attention counts. Only
a successful later attempt clears that work identity; server timestamps prevent
an older overlapping success from clearing newer attention. Existing settlement
error codes remain visible as well. It does not release a claim,
change an idempotency key, free inventory, or bypass a proof. If time expires
between a durable claim and POST admission, that claim remains uncertain even
though this invocation did not send; only verified reconciliation can clear it.

A single indivisible proof/dispatch unit must fit the admission budget. For
example, ten sequential 30-second proof reads cannot fit a 120-second run.
Durable phase fairness does not solve that architectural limit. Repeated budget
attention requires an operator to validate a larger supported execution context
or redesign the proof workload; stale proof caching is not a safe shortcut.
Eventual progress is tested for work fitting the configured budget, not promised
for arbitrary provider delays or unbounded pagination. Database calls are not
forcibly canceled, and no hard production runtime or payout SLA is claimed.

Replacement cleanup also recognizes independently verified `fulfilled` as
terminal success. Its immutable terminal transition clears matching runtime
attention atomically. Late cleanup observations lock that same work row before
attention and cannot recreate a blocker after terminal completion. Unresolved
cleanup retains the generic timestamp rule; no completed-history sweep, financial
retry, or inventory release is authorized by this operational bookkeeping.
