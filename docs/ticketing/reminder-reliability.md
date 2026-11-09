# Pre-event reminder reliability

## Scope

The existing reminder sweep remains every 15 minutes and retains its original eligibility interval: event starts at least 150 minutes and less than 210 minutes after the sweep. This is approximately three hours, not a promised exact send time. No historical enrollment, catch-up outside that interval, manual sends, cron changes, ticket issuance, ownership changes, or payment/accounting changes are included.

Event-level `reminder_sent_at` no longer excludes newly issued tickets. Existing ticket sent markers are never cleared. New unsent tickets receive a separate delivery bundle containing only those tickets. Bundles group by current account identity or guest address, with at most 100 tickets per bundle. A very large recipient group can therefore have multiple messages. Ordinary purchase/comp/transfer receipts already include event/ticket details; this change does not add reminders outside the existing window.

## Delivery and privacy

A service-only RLS queue and atomic per-ticket reservation prevent competing sweeps from independently bundling the same ticket. Provider payloads and idempotency keys remain immutable across retries. Leased compare-and-set updates require a nonblank provider message ID before marking sent. Null responses and provider failures do not stamp ticket success. Provider acceptance does not prove inbox delivery or reading.

Current ownership, event cancellation, ticket status, recipient address and guest access tokens are checked before each attempt. Account messages link to authenticated ticket views and contain no raw QR or guest credentials. Guest links must still be current and unexpired. Event date formatting uses the event timezone, with explicit UTC fallback.

If ownership changes after reservation or an uncertain send, the old bundle is suppressed rather than rebuilt under the same provider key. Reservations are not reset: the new owner can receive their ordinary transfer receipt but is not guaranteed an additional reminder. External email and database transactions cannot be made atomic; stable provider idempotency and authenticated/revocable links address retry and stale-access risks without promising absolute delivery.

Unavailable recipients and exhausted/expired attempts remain inspectable rather than falsely marked sent. Completed-event flags are legacy metadata; response `events_completed` is intentionally empty, while `events_processed` and email attempt counters describe this invocation only. Do not interpret either as an inbox-delivery count.

## Deployment approval and verification

Candidate only: apply `20261031000336_durable_event_reminders.sql`, then deploy the reviewed `event-reminders` closure after confirming prior old-version invocations have drained between cron ticks. Never run old and new implementations concurrently: old code does not honor the reservation queue. The migration itself creates an empty queue and does not enqueue or send anything. Preserve the deployed email template/style bytes while adding the current idempotency/timeout-capable send helper and new reminder helper. No other producer or reconciliation function needs deployment.

Before approval: execute offline handler/helper tests and the disposable PostgreSQL concurrency harness, plus ticket regression suites and CI. Verify existing schema prerequisites (`tickets.guest_lookup_expires_at`, `reminder_sent_at`, guest tokens, and account verified-email fields); do not create unrelated columns speculatively. Any release or one-time catch-up requires separate explicit approval. Existing historical reminder flags must not be reset for testing.
