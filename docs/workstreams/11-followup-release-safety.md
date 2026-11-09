# Post-event follow-up repair: release and bounded catch-up

Source-only change. This PR does not deploy, migrate production, create campaigns,
change credentials, or send email. The default remains **organizer opt-in**, at
canonical event end + 600 minutes (3-hour duration fallback if end is absent).
No global automatic enrollment or historical sweep is introduced.

## Required release scope (explicit operator approval)

1. Deploy the companion web fix first: `/public/events/{id}/reviews` must work
   signed in and preserve the target through login/signup/admission. This browser
   URL avoids the existing iOS `/feed/*` universal-link interception. Android
   builds with a catch-all verified link can still intercept this path; verify a
   supported Android entry path before claiming all-platform delivery readiness.
2. Pause the existing follow-up cron and allow any old worker invocation to finish.
   Apply `20261031180000_event_followup_delivery_safety.sql`. The unique index
   intentionally fails on historical duplicates rather than deleting records.
3. Deploy `process-event-followups` with all imported shared files, including the
   **current dark brand email kit** and the updated helper. Deploy
   `event-followup-settings` with its fail-closed read handling. Restore the same
   existing 15-minute schedule; do not add new global enrollment.
4. Reuse existing in-situ `CRON_SECRET`, `RESEND_API_KEY`, `RESEND_FROM_EMAIL`,
   `EVENT_FOLLOWUP_UNSUBSCRIBE_SECRET`, `SUPABASE_URL`, and service key. Do not
   export or rotate them. Missing configuration blocks sending.

## Preview before catch-up

Service-only `dispatch_event_followups(event_ids, preview_email, content)` accepts
one event when `preview_email` is present. It reads the existing cron secret
server-side and queues the HTTPS request. It never reveals a secret. Content is
optional validated plain-text JSON, with `subject`, `message`, `cta_label`, and
`profile_cta_enabled`; arbitrary HTML, URLs, and extra fields are rejected.

Preview is one durable record per event/address, separate from attendee history,
with an honest preview footer. It does not require a ticket or create a campaign.
The requested subject/body can be supplied identically to preview and catch-up.
`profile_cta_enabled: true` adds **Join the community**, linking through ordinary
login/signup with the review return target. It does not create an account.

Verify the preview's provider message ID AND the owner's inbox before proceeding.
Provider `accepted` is not inbox delivery. Repeated preview requests reuse the
same record; do not manufacture a new preview ID after an uncertain result.

## Explicit selected-event catch-up

Only after approval and preview verification:

- Recount **current active/scanned admission tickets**, using the authoritative
  matching `ticket_types.category = 'admission'` (not legacy ticket category).
  Free/comp/VIP admissions remain eligible. Service-only purchases do not.
- Resolve `claimed_by`/`user_id` to the current account, otherwise guest email;
  dedupe normalized address per event. Do not require an existing account or
  verified-email flag for this noncredential review invitation.
- Respect address unsubscribe and account brand opt-outs, including guest-ticket
  addresses that match an account case-insensitively. Both are rechecked before
  each send, and again at payload preparation. Lookup errors fail closed.
- Call `enable_event_followup_catchup(explicit_event_ids, content)` for at most ten
  approved completed events. This explicitly permits earlier-than-default catch-up
  now. It never overrides an organizer-disabled campaign or a completed campaign.
  Plain-text content overrides affect only these selected campaigns.
- Call `dispatch_event_followups(explicit_event_ids)` until selected outbox rows
  reach terminal outcomes. Each call processes at most 64 records, at most 2/s.
  Cron can safely continue pending rows with the same dedupe/lease rules.

`recipient_email` is required for guests: no bulk account creation or import.
This can only reach public website buyers whose tickets exist in this database.
External ticket platforms need a separately verified source and lawful suppression
mapping; do not pretend an external audience was included.

## Retries and observation

- Logical uniqueness is event/address/purpose, independent of campaign version.
- Claim uses `FOR UPDATE SKIP LOCKED`, a two-minute lease, and unique lease token.
- Eligibility checks **any** remaining current admission for the address, so one
  refunded ticket does not exclude somebody who still has a valid admission.
- Payload and provider idempotency key are frozen before the external call.
  Provider timeout/DB-stamp failures retain that same payload/key.
- Automatic retries stop 23 hours after first preparation, below provider 24-hour
  idempotency retention. Expired uncertain rows require provider reconciliation;
  do not reset them or create replacements. `partial_failure`/`failed_count`
  exposes such rows rather than falsely reporting all sent.
- Aggregate counts exclude preview rows. Accepted-but-unstamped records stay
  leased and recoverable. Report accepted counts separately from delivery.
- Suppressed rows are not silently reactivated. Organizer disable/unsubscribe
  and canceled/refunded/transferred-away cases never reset ticket/send ledgers.

## Verification

`NODE_PATH=<isolated typescript + @electric-sql/pglite dependencies> node --test
apps/mobile/supabase/functions/_shared/event-followup*.test.cjs
apps/mobile/supabase/functions/process-event-followups/*.test.cjs
apps/mobile/supabase/functions/event-followup-settings/*.test.cjs`

These execute real embedded PostgreSQL schema/RPC/lease contracts, actual handler
and delivery code with synthetic providers, and the existing renderer tests.
Embedded PostgreSQL serializes queries; it is not a multi-process production
load test. The workflow runs the same offline checks without production secrets.
