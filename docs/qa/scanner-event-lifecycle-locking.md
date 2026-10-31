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
