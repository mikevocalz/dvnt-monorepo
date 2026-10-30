# Automatic ticket receipts

## Behavior

Future member and guest comp issuance enqueues one receipt per recipient/order,
containing the separate tickets issued together. Phone comps have no email
recipient until an account claims the ticket; the successful claim enqueues its
receipt. Accepted transfers enqueue one receipt, replacing the prior direct send.
Existing transfers retain their in-app notifications and credential rotation.

Receipt acceptance is independent of issuance. `delivered` in the compatibility
API means the email provider accepted the request, NOT inbox delivery or opening.
The UI distinguishes accepted, queued, failed and unavailable email outcomes.
No email failure instructs the host to issue more tickets. Missing/unverified
member email is an explicit unavailable outcome, not silent success.

Member links require sign-in and point to exact ticket IDs. Emails never include
member QR credentials or guest access tokens. Guest access links remain guest-only.
Every attempt checks current ownership, ticket and event validity. A changed
recipient, transferred/void/refunded bundle, or rotated guest credential suppresses
stale delivery rather than exposing an old credential.

## Durability and scope

A service-only, RLS-protected outbox is enqueued in the same transaction as the
new wrapper issuance/claim/acceptance RPC. Existing atomic RPCs are unchanged.
There is no historical enqueue or backfill. The existing authenticated order
reconciliation cron retries only these explicitly queued receipts, in bounded
batches. It excludes their guest orders from the old checkout-email retry path.

Leases serialize send attempts. The first provider payload (including sender,
recipient, subject and rendered HTML) is frozen; retries use the same payload and
provider idempotency key. Automatic retries stop before the provider's 24-hour
idempotency window expires, and after a bounded number of attempts. An exhausted
or suppressed receipt requires a separately authorized recovery decision, never
an automatic new key or ticket reissue.

## Proposed release (requires separate approval)

1. Apply `20261030215857_durable_ticket_receipts.sql` (new queue + service-only
   wrappers and queue RPCs, no existing-ticket changes, no cron or credential changes).
2. Deploy `reconcile-orders` with receipt-managed guest-order exclusion and the
   new delivery helper before producers use wrappers. Existing cron auth stays.
3. Deploy `bulk-comp-tickets`, `claim-comp-ticket`, and `transfer-ticket` with the
   complete reviewed dependency closures. Old direct comp/transfer mail sends
   must not coexist with wrapper enqueue in these handlers.
4. Release web UI; native UI follows the normal native release process.
5. Verify deployed sources, schema grants/RLS, empty initial queue/no backfill,
   unauthorized worker access, and final deployment/check status. No live test
   tickets, messages or payments are authorized by implementation approval.

Rollback must preserve queued receipts and their stable keys. Restore old handler
RPC callers only with reconciliation paused for affected future receipts under a
separately reviewed plan; never reset sent state or mass-reissue tickets.
