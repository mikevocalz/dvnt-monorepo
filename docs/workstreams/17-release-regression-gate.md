# DVNT Workstream 17 — Release regression and readiness gate

## Goal
Turn the high-risk DVNT surfaces that have repeatedly regressed into an executable release gate with evidence, not a manual memory checklist.

## Scope

### 1. Events matrix
Automate/record:
- Public
- Private
- Link-only
- Draft
- Upcoming
- Live
- Past
- Cancelled
- Postponed

For each state verify:
- discovery/list presence
- host profile presence
- signed-out public route
- attendee access
- checkout/RSVP availability
- edit/delete availability
- sharing/deep link
- Who's Going privacy
- canonical timezone display

### 2. Ticket rails
Exercise:
- paid member ticket
- free member ticket
- guest email ticket
- comp member
- comp guest
- phone/SMS comp once Workstream 07 lands
- transfer initiate/accept/decline/expire
- refund
- event cancellation/postponement
- QR scan/door fallback

Assertions include order↔ticket integrity, no duplicate issuance on retry, and account-safe ticket caches.

### 3. Posting/media
- photo post
- video post
- camera capture
- post location
- queued upload
- second consecutive post
- browser/app restart during publish
- account switch with queued post
- event image flyer
- event video flyer at realistic sizes
- replace event flyer while editing

### 4. Event timezone
Fixtures for at least:
- America/New_York
- America/Los_Angeles
- DST transition

Verify physical event renders in venue-local time while lifecycle checks operate on absolute UTC instants.
Never regress to start-time-as-end-time behavior.

### 5. Private event E2E
Host:
1. create private event
2. invite selected members
3. invitee receives Activity/DM/email as configured
4. invitee opens event
5. outsider denied
6. invitee ticket/Lynk access succeeds
7. revoke invite and access updates correctly

### 6. Proximity/location
- location permission granted/denied
- place search without geolocation
- visibility enabled/disabled
- blocked user
- same-city fallback
- web/native label parity
- no raw coordinate exposure

### 7. Age/verification
Once Workstream 01 lands:
- 17-year-old signup refused
- exactly-18 boundary accepted
- provider approve/retry/reject
- existing member outside cohort remains usable
- restricted/SPICY direct API write denied when policy requires verification
- account switching cannot borrow verification

### 8. Sneaky Lynk
Once Workstream 12 lands:
- scheduled room exists but is not live
- early invite opens waiting state
- event start transitions to live
- eligible ticket holder joins from deep link
- host disconnect/rejoin
- in-room invite
- refunded ticket denied
- room ends and leaves live listing
- stale listing removed within policy/24h max

### 9. Activity/notifications
- ticket comp
- ticket transfer
- promoter invite
- private-event invite
- event change
- unread/realtime behavior
- account switch
- deep links resolve to authorized destination

### 10. Open crash/observability debt
PR #11 remains an explicit release-readiness item until:
- web theme crash fixes are reconciled/merged or superseded
- mobile crash reporting retains the original fatal reason
- recurring iOS startup crash is either root-caused/fixed or explicitly waived with current evidence
- relevant Sentry production issue state is reviewed, not assumed

## Gate structure

### Fast PR gate
Run on every PR where relevant:
- typecheck
- lint
- unit tests
- edge function verification
- route verification
- migration/static security checks
- targeted Playwright contracts

### Nightly/integration gate
Against a disposable/test environment:
- full event matrix
- ticket rails
- webhook/reconciliation replays
- concurrency/idempotency tests
- account-switch tests
- notification routing

### Release-candidate gate
- production-like web build
- iOS device smoke
- Android device smoke
- large-media transfer
- camera/permission flows
- door scanner
- scheduled Lynk timing
- verification provider sandbox/live-safe check
- crash-free startup evidence

## Evidence
Each release run should produce:
- commit SHA
- environment
- migration version
- test summary
- screenshots/video only where visual proof matters
- failed scenario + issue/PR link
- explicit waived items with owner/reason

Do not mark a release "green" because an unrelated test suite passes.

## Acceptance criteria
- [ ] Every critical scenario has an automated or explicitly documented device test.
- [ ] A failed critical scenario blocks release by default.
- [ ] Account switching is covered for posts, tickets, notifications, and verification.
- [ ] Private/link-only data is tested for non-disclosure.
- [ ] Timezone tests include NYC + LA + DST.
- [ ] Realistic large event-video upload is part of RC verification.
- [ ] Ticket issuance replay tests prove exactly-once behavior.
- [ ] Scheduled Sneaky Lynk lifecycle is exercised end to end.
- [ ] PR #11 crash/observability state is explicitly resolved or waived before release.
- [ ] Release evidence is committed or attached to the release/CI artifact.

## Out of scope
This PR does not replace each feature workstream's own unit tests. It defines the cross-feature release contract that catches integration regressions.
