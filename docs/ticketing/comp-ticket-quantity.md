# Up to three comp tickets per recipient/tier

The organizer selects a **desired total**, 1, 2 or 3, not an additive quantity.
A retry only issues the missing tickets, so repeatedly requesting 3 cannot
mint 6 or 9. Each seat has its own ticket ID/QR and can transfer independently
through the existing member transfer flow. Guests must claim into an account
before member-to-member transfer; each phone ticket has a separate claim link.
Guest email delivery groups all newly issued ticket links into one email.

## Existing policies retained

- Event owner or accepted admin may issue; scanner/editor roles cannot issue.
- The recipient batch cap remains 100, independent of the 1–3 ticket target.
- Active, scanned and transfer-pending tickets count, including paid tickets.
- Member/email counts follow the current `user_id` / `guest_email`, as before.
  A transferred-away ticket no longer counts toward its sender's target.
- Phone counts follow the originating claim link/phone, even after claim or
  transfer, as before. Reissuing rotates each unclaimed active link without
  consuming more inventory. Reducing the target never revokes existing tickets.
- This is an issuance target, not a new global ownership/transfer cap. The
  existing transfer restriction on an already-ticketed recipient remains.
- Existing comp event advisory locks, tier row locks, and both live hold types
  protect inventory. Mixed member/email/phone groups are still separate RPC
  transactions; a later group's failure does not roll back an earlier group.

## Release dependency

Apply `20261027212000_three_comp_tickets.sql` and
`20261027212100_atomic_ticket_transfer_acceptance.sql` through the normal
reviewed migration process **before** deploying the updated edge functions.
The first upgrades all three comp RPCs and serializes phone claims with issuing;
the second adds service-only `accept_ticket_transfer_atomic`. Four-argument RPCs remain as backward-compatible quantity-1 wrappers;
new five-argument RPCs remain service-role only. Then release the clients.
This change does not apply a migration, deploy an edge function, issue a live
comp, transfer a live ticket, or alter live staff permissions.

Transfer credential hardening also requires deploying `transfer-ticket` and
`ticket-scan`: old guest links and previous signed/raw QR credentials must not
reveal or redeem a transferred ticket. Acceptance moves ownership, invalidates previous credentials and marks the
transfer accepted in one transaction. Initiation and cancellation/decline still
use the existing multi-request flow, with owner/status/check-in guards. Add-on
moves and email remain post-acceptance best effort, as before.

## Verification

- `npm run test:comp-tickets`: shared helpers, mounted web/native forms, actual
  client wrapper and edge handlers with offline fixtures, transfer/redemption
  crypto and credential invalidation.
- `npm run test:comp-tickets:sql`: disposable PostgreSQL with real concurrent
  sessions/lock waits, targets/retries, capacity/holds, claim races, permissions
  and migration reapplication. Requires a local PostgreSQL server and `pg`.
- `POSTGRES_SINGLE_USER=1 npm run test:comp-tickets:sql`: explicit socket-free
  sequential PostgreSQL fallback; **concurrency is not tested** in this mode.
- The dedicated CI workflow runs the full socket-based SQL suite, not fallback.
