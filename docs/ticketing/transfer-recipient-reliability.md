# Ticket transfer recipient identity and errors

The transfer endpoint resolves the recipient's current app profile handle in
`public.users`, then validates its `auth_id` against `public.user.id`. Better
Auth's `user.username` is not the source of the visible handle and may be stale.
Never fall back to it: the same handle may belong to a different member now.
Case-insensitive matching supports existing mixed-case profiles; underscores
are escaped as literals, and multiple matching profiles fail closed. Missing,
unlinked and deleted accounts fail before ticket/wallet writes.

All four shared client transfer actions parse structured HTTP refusals instead
of exposing the SDK's generic non-2xx message. Internal/server/proxy errors stay
private, with a reminder to check My Tickets before retrying an uncertain result.

## Release

Deploy reviewed edge bundles for `transfer-ticket`, `door-sell`, `ticket-checkout`,
`guest-checkout`, `stripe-webhook` and `reconcile-orders` to the existing shared
backend, then release the shared client. The five email consumers must carry
the updated shared `ticket-email-delivery` helper: order retries/resends must
never return a transferred recipient’s new QR to the original buyer. Pending
transfers are also withheld; untransferred claimed/guest tickets remain deliverable. No new database migration, ticket ownership repair,
refund, email or entitlement change is required. Existing atomic acceptance,
credential rotation, event/ownership/status checks and recipient ownership
restriction remain in force. Release verification must distinguish passing
repository contracts from an actual live customer transfer; do not execute a
real transfer without specific authorization.

## Regression checks

- Actual handler fixtures cover current/stale/reused/mixed-case handles,
  malformed/missing/unlinked/deleted recipients, lookup failure, 1–3 comp
  siblings, ownership/scan/refund races, expiry and old credentials.
- Actual shared API wrapper tests cover all four actions, safe refusals,
  authentication, malformed responses and transport errors.
- `test:ticket-release` includes these client checks and the existing ticket
  issuance/payment/refund/scan contracts.
- `test:comp-tickets:sql` runs disposable PostgreSQL contracts including literal
  case-insensitive recipient lookup and real atomic acceptance/concurrency.
