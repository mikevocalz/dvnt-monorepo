# DVNT Workstream 04 — Event drafts, duplication, templates, and reusable collaborators

## Goal
Make event creation resilient for organizers who run repeated events, while keeping the existing accidental-duplicate protection.

## Important distinction
The database now prevents accidental duplicate live events. This feature must NOT weaken that protection. "Duplicate event" is an explicit organizer workflow that creates a **draft copy** with a new identity/idempotency key.

## Scope

### 1. Draft event model
Support drafts that can safely hold:
- title / description
- date/time/timezone
- venue/location
- visibility
- flyer/video references
- ticket tier configuration
- add-ons where supported
- collaborator selections
- promoter/promo-code templates
- post-event follow-up settings

Drafts are not discoverable, ticketable, shareable as live events, or eligible for event-room admission.

### 2. Autosave
- debounced save after meaningful changes
- manual "Save draft"
- offline/local pending state where appropriate
- conflict-safe server revision/version
- restore after browser/app restart
- clear saved state after successful publish

### 3. Draft management
Organizer surface:
- Drafts list
- last edited timestamp
- event preview
- continue editing
- duplicate draft
- delete draft with confirmation

### 4. Duplicate Event
From a live/past event:
- create a new draft
- copy reusable content
- never copy attendee/ticket/order/QR/review/room runtime state
- dates default to unset or a clearly editable new schedule
- require confirmation of timezone and ticket sales windows
- media may reference existing immutable assets rather than re-uploading bytes

### 5. Collaborator/promoter duplication
Copy as reusable configuration:
- promoter identity
- role/status as a fresh invitation where needed
- promo-code configuration
- discount/commission settings
- staff/co-organizer templates if product approves

Do not silently grant sensitive event permissions because they existed on a previous event; require new acceptance for roles that should be re-authorized.

### 6. Organizer templates
Promoters/ambassadors who are repeatedly used should become organizer-level reusable records. Event duplication can select a saved set rather than cloning raw event rows indefinitely.

## Acceptance criteria
- [ ] Closing/reopening event creation restores the draft.
- [ ] Draft is absent from public event queries and checkout.
- [ ] Publishing a draft creates exactly one live event.
- [ ] Repeated publish taps/retries do not duplicate the event.
- [ ] Duplicate Event always starts as a new draft.
- [ ] No attendee/order/ticket/review/live-room state is copied.
- [ ] Promoter/promo configuration can be copied intentionally.
- [ ] New schedule/timezone must be reviewed before publish.
- [ ] Existing unique duplicate guard remains enforced.
- [ ] Draft deletion is explicit and recoverable only if product adds trash/history.

## Tests
- web/native create → kill app/browser → resume
- two devices editing same draft
- duplicate past/live/cancelled event
- duplicate with video flyer
- duplicate with promoters/codes
- publish retry / offline retry
