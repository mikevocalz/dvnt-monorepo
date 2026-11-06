# Explicit host recap delivery

This is an operator-approved, one-time sender, not an accounting calculator or
scheduler. It reuses the existing DVNT Resend configuration in situ. It never
initiates payouts, modifies tickets/orders/users, enrolls attendee campaigns, or
calls the general brand outbox worker.

## Scope and approval

The additive migration creates one private RLS-enabled ledger and service-only
functions. The worker accepts exactly one delivery UUID plus its approved SHA-256
hash. It accepts no recipient, HTML, events, or financial numbers from the HTTP
caller. Enqueue is a separate explicit service operation with selected completed
events, a `YYYY-MM` period, approved subject/HTML, and the content hash.

The content hash is lowercase hex SHA-256 of UTF-8 `subject + "\n" + html`.
Keep actual statements, recipient addresses and approval evidence in private
runtime artifacts, never in this repository or public CI. The operator must
verify the local-event-start month cohort; a cross-month end does not by itself
exclude an event. Events with missing or future end times are held.

All selected events must resolve to the same current host. The database derives
the recipient from that host, and rechecks ownership, address and suppression at
claim time. Generic acknowledgments require a verified account address and no
recorded charged order/ticket; this means no revenue recorded on DVNT, not proof
about outside/offline sales. A financial recap can use an explicitly confirmed
current host address, bound to this exact queued record, without changing the
account's verification status. One host/period uniqueness prevents sending both
a financial recap and a generic duplicate to the same host.

## Delivery and uncertainty

Claim freezes the configured sender and moves only that row to `sending` under
a database lock. The worker rehashes the approved body before calling Resend,
using stable key `host-recap:v1:<delivery UUID>`. It records a provider acceptance
ID; acceptance is not proof of inbox delivery.

There is no automatic retry, lease reclamation or scheduled sweep. A provider
exception or missing receipt becomes `unknown`; an accepted message whose DB
stamp fails remains `sending` with an explicit accepted-pending-record response.
Repeated calls to either state must not send again. Investigate original provider
receipts before any manual reconciliation; never manufacture a new period/row to
resend an uncertain message. Return failure details without exposing statement
contents or credentials in logs.

## Release checklist

1. Review exact-head tests, migration grants, approved private snapshots and host
   recipient resolution. Confirm financial/generic cohorts and suppression.
2. Apply only the additive host recap migration, then deploy only
   `host-recap-email` and its imported shared dependency closure.
3. Reuse existing `CRON_SECRET`, `RESEND_API_KEY`, `RESEND_FROM_EMAIL`,
   `SUPABASE_URL`, and service role key; do not export or rotate them. Missing
   configuration blocks delivery. No cron changes are needed.
4. Enqueue only the explicitly approved rows, inspect their hashes/current host
   recipients, then dispatch each exact UUID/hash once. Record RPC request IDs,
   provider IDs and accepted/unknown distinctions. Do not invoke unrelated
   payout, brand, ticket or attendee workers.
