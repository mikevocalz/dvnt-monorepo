# Correct an incorrectly issued free ticket

Event owners can open **Attendees → Cancel free ticket** for one ticket, verify
the event/city, account holder, tier and ticket ID, and enter a reason. This
permanently voids that one admission and returns its inventory atomically.
Issue the correct event ticket separately only after reviewing the recipient.
No replacement, monetary refund, email, push or recipient notification is sent.

The action is deliberately not called “undo comp”: historical comp issuance has
no reliable provenance distinct from ordinary free checkout. Both are eligible
only with an exact-zero matching original paid order, no payment/session/cart/
promo evidence, the same registered original owner and an unused active ticket.
Paid, discounted, scanned, transferred/pending-transfer, guest/claimed and older
unverifiable no-order tickets require manual review; they cannot use this action.
Existing Refund endpoints refuse free/unknown amounts rather than bypassing it.
A financial-snapshot guard rolls the entire cancellation back if existing
accounting triggers change gross, refunds, fees or net. Such tickets require
manual accounting review; this feature never repairs payout calculations.

## Scanner limitation
The old QR fails **online** validation after cancellation commits. A scanner
with a previously downloaded offline allowlist must reconnect and refresh before
admitting guests. An offline device cannot receive an immediate revocation.
Wallet invalidation is persisted; no APNs delivery is claimed.

## Release sequence
1. Run focused tests and disposable PostgreSQL cancellation/scan/transfer tests.
2. Apply only `20261030043000_organizer_cancel_free_ticket.sql`, after reviewing
   its service-only RPC and new audit-table permissions. It changes no tickets.
3. Publish `organizer-cancel-free-ticket`, `get-event-tickets`, `organizer-refund`
   and `bulk-refund-tickets` with Better Auth-compatible `verify_jwt=false`,
   preserving unrelated deployed dependency drift.
4. Release web UI; native UI requires the normal native release channel. Older
   clients safely refuse free cancellation via their legacy refund action.
5. Verify deployed sources/versions, grants and web build read-only. Do not invoke
   cancellation, refunds, sends or issue replacement tickets as a smoke test.

UI fails closed without server-provided eligibility; SQL rechecks authorization,
reviewed holder, financial evidence and scan/transfer state under locks. Same
actor/event/holder/reason retries return the original result without another
seat decrement. The immutable audit retains the original issuance/order rows.
