# DVNT Workstream 11 — Post-event organizer follow-up

## Goal
Let organizers automatically send a custom attendee follow-up around 10 hours after an event ends, with a direct path to reviews.

## Scope

### 1. Event settings
Organizer dashboard/edit settings:
- toggle: Send post-event follow-up
- custom message
- preview
- optional subject override within brand constraints
- review CTA label
- test-send to organizer
- status: scheduled / processing / sent / partial failure / disabled

### 2. Scheduling
Anchor from canonical event end:
- explicit end_date when present
- otherwise the repo's established fallback end calculation
- timezone-safe absolute instant
- default delay: 10 hours after end

Do not schedule from the start time.

### 3. Audience
Eligible attendees should be derived from authoritative attendance/ticket state.
Define rules for:
- active ticket holder
- checked-in attendee
- comp/guest ticket
- refunded/void ticket
- event cancelled/postponed

Default recommendation: send to valid attendees for completed events; skip refunded/void and cancelled events unless product explicitly enables a different message.

### 4. Delivery
Use durable outbox semantics:
- one row per event + recipient + campaign version/channel
- retries independent per recipient
- exactly-once logical send
- Resend/provider message ID persisted
- template includes event identity and organizer message

### 5. Review CTA
Button routes directly to the event review section/sheet.
Signed-out guest path must authenticate/claim safely and preserve return target.

### 6. Organizer visibility
Dashboard shows:
- audience count
- scheduled time
- sent count
- failed count
- retry failed
- cancel future send before dispatch

Do not expose attendee emails unnecessarily in aggregate status UI.

### 7. Communications preferences
Classify the message correctly. Transactional post-event follow-up/review solicitation should follow applicable user communication preferences and legal requirements; do not piggyback it onto ticket-delivery exemptions.

Before every send the worker checks `event_followup_email_suppressions` (by address, covers guests) and `brand_message_opt_outs` (members who turned off growth messages). A failed lookup retries the row instead of sending. Each email carries a visible unsubscribe link and `List-Unsubscribe` / `List-Unsubscribe-Post` headers pointing at `event-followup-unsubscribe`, which takes an HMAC-signed token and never reveals whether an address is known. The worker and the endpoint both refuse to run without `EVENT_FOLLOWUP_UNSUBSCRIBE_SECRET`.

## Acceptance criteria
- [ ] Organizer can enable/disable follow-up per event.
- [ ] Organizer can write/preview/test custom copy.
- [ ] Job schedules at event end + 10h using canonical end logic.
- [ ] Each recipient receives at most one follow-up per event. Editing the copy or send time bumps `campaign_version` but only reaches attendees not yet mailed; a no-op save writes nothing. Re-sending to past recipients has no trigger yet.
- [ ] Refund/void/cancel rules are deterministic.
- [ ] CTA opens the correct event review surface.
- [ ] Organizer can see sent/failed status and retry failures.
- [ ] Duplicate cron runs do not duplicate email.

## Tests
- explicit end vs fallback end
- NYC/LA timezone
- cancelled/postponed event
- guest comp/member/paid attendee
- retry/provider outage
- organizer disables after scheduling
