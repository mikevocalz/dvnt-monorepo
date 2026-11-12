# Refund and dispute debit reservations

Draft implementation only. No provider or live database changes were performed.

For a new-ledger refund, all six current refund transports claim a durable
currency debit before POST. The order and global funding control row are locked
in the same order as transfer reservation. Start invalidates the funding epoch.
Explicit partial refunds reserve the requested amount; whole-order requests
reserve the full original order amount conservatively. The same request or the
same ticket/cart line cannot dispatch again under another transport key.

Timeouts, HTTP errors, declined requests without a verified Refund object, and
failed response persistence retain the debit. A claimed intent is never resent
automatically, even after Stripe idempotency retention expires. Read-only refund
pagination can reconcile an intent by its exact metadata. Pending refunds keep
all funds reserved. Successful refunds release the debit only after an exact
available refund balance transaction proves the outgoing amount and currency.
Failed/canceled refunds can release only with a verified terminal Refund object
with neither debit nor failure balance transaction; otherwise manual review is
required. Completion invalidates the epoch again so pre-completion balance
snapshots cannot fund another transfer. Release of the debit does not release
any refund hold or cancel existing recovery obligations.

Dispute holds reserve the full original charge by currency and remain in
`manual_review`. This may deliberately over-reserve against already deducted
funds. There is no automatic dispute-debit release API and no synthetic Refund
object or reversal is invented. The reviewed dispute recovery workflow must
prove provider outcomes before any future release implementation.

## Remaining boundaries

- This addresses registered new-ledger refund/dispute activity. Dashboard,
  external-service and legacy destination-charge refunds can change the same
  platform balance without registering an intent. Coexistence requires a
  separately reviewed available-balance/risk policy and provider validation;
  this implementation is not a guarantee against untracked provider debits.
- A provider refund omitted from complete pagination, missing identity metadata,
  or unclear failure-balance return leaves its intent reserved for review.
- A pending worker must run read-only reconciliation; a missing worker is not
  permission to send another refund or clear reservations.
- PostgreSQL/WASM tests exercise the actual SQL. Native concurrent-session cases
  for refund start, completion and already-paid enrollment are added to the
  disposable GitHub Actions runner. Local compilation/refusal checks do not
  mean those native cases have executed.
- Real sandbox/provider outcomes, schema/deployment review, funding policy,
  scheduler provisioning and alert routing remain explicit rollout gates.

A definitively canceled/failed refund can release its reserved currency debit only with terminal provider evidence. The ticket/cart-line uniqueness marker remains: a second automatic refund attempt is not allowed merely because the first was canceled. A reviewed retry/recovery workflow is required; no implicit reset or automatic new key is provided.
