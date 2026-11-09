# Atomic scanner lifecycle guard

The previous `redeem_ticket` / `redeem_addon` definitions accepted active
credentials without checking event lifecycle. Event cancellation marks the event
cancelled before asynchronous ticket refunds/voids finish, leaving an admission
window. The new migration rejects cancelled/canceled/deleted event status within
the same transaction as redemption. Null legacy, postponed, and ended statuses
are not newly restricted. No historical ticket/check-in rows are rewritten.

## Lock order and tradeoff

1. Lock the exact credential row (`FOR UPDATE`). This serializes duplicate scans
   and waits for ownership/token rotation before re-evaluating the old token.
2. Lock its matching event (`FOR NO KEY UPDATE NOWAIT`). A cancellation that has
   already committed is observed before admission; cancellation that loses this
   lock waits for the scan transaction to commit.
3. Keep the existing compare-and-swap plus audit insert in the same transaction.

Ticket status triggers update event attendance. Event-first SHARE locks could
produce lock-upgrade deadlocks across two scanners; blindly waiting after locking
a ticket could deadlock against legacy event-first issuers. NOWAIT instead returns
`retry_later` with no admission. The edge maps this to HTTP 503, not an invalid
credential. Concurrent scans of different tickets can therefore require a retry
when competing for the same event row; the isolated PostgreSQL test verifies a
bounded caller retry admits each of eight distinct tickets once. This is a
correctness tradeoff, not a measured door-throughput guarantee.

Cancelled credentials audit `invalid` under the existing checkins constraint,
while the response explicitly says `event_cancelled`. Existing service-role-only
execution permissions and search path remain unchanged.

## Verification boundaries

`ticket-scan/lifecycle-sql.test.cjs` runs the actual old and new SQL against a
socket-only disposable PostgreSQL instance. It reproduces the old cancellation
window and tests both cancellation/scan lock orders for tickets and add-ons,
legacy status compatibility, real concurrent scans, and old-token rotation.
`bulk-comp-tickets/quantity-sql.test.cjs` separately covers duplicate admission,
transfer acceptance, refund/void contention, independent comp tickets, offline
replay conflict attribution, and audit failure rollback.

These fixtures do not check in live tickets, use private QR codes, exercise
physical cameras, or prove actual-device transport/throughput. The migration is
source-only until separately approved and applied; CI results must be checked
for the exact published head before release.

## Financial trigger prerequisite

The ticket/add-on statement triggers also upsert `event_financials`. An issuer
can lock that row from its order insertion before trying to update attendance;
scanner event-lock then financial-lock waiting would form a deadlock. The scan
therefore takes the existing financial row with NOWAIT before mutating its
credential. Contention returns `retry_later`. A missing (including another
transaction's uncommitted) row returns `financials_unavailable`/HTTP 503 without
creating a zero summary or recomputing accounting. This avoids an unbounded
unique-index wait and requires a legitimate financial summary before admission.
A missing summary needs separate investigation, not repeated blind scanning.

The lifecycle fixture runs the actual repository attendance functions and
financial row/statement triggers, with the deployed financial recomputation body
verified by read-only comparison. It tests order-first financial contention and
missing/uncommitted summaries on both rails. Existing production metadata showed
zero missing summaries among the 28 events with active admission credentials at
review time; that aggregate is not a guarantee for future rows or native devices.

## Required release order

Deploy the reviewed `ticket-scan` edge handler that understands
`event_cancelled`, `retry_later`, and `financials_unavailable` **before** applying
the new RPC definitions. Old handlers classify unfamiliar RPC results as an
invalid/missing ticket, so migration-first rollout is unsafe. Client retry/error
handling must also be verified; never treat HTTP 503 as permission for offline
admission. All migration/deployment steps still require explicit approval.
