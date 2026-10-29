# Sneaky Lynk event quality — 2026-10-29

## Scope

The request concerns a **free Sneaky Lynk afterparty event**, not merely a standalone video room. The supplied screenshot is a third-party planning message, not an error screen or authorization to publish an event. All tests use isolated synthetic data. No live events, purchases, invitations, messages, credentials or migrations were changed.

## Defects repaired

- Web and native creation no longer publish an event missing the private room the organizer explicitly requested. Setup errors stop publication with retry guidance. Successful room setup is retained by account and draft across publish retries; simultaneous/repeated requests share pending work. A slow response releases the UI after 20 seconds without spawning another request. Changed drafts/accounts reject stale completion.
- Event detail no longer creates a generic replacement room or silently relinks the event when opening it. Host start is server-confirmed and idempotent; the original room is used. Single-flight and account/session/event/unmount guards prevent duplicate or stale navigation. Errors and waiting-list retry are visible.
- Waiting guests are rejected after expiry, even if the host never started. Closed/missing rooms and terminal lifecycles cannot admit guests. Start uses the same expiry policy as join/token refresh and refuses invalid schedules.
- Host waiting-list caches are account-scoped and hidden on disabled/error state; terminal polling stops. Existing sensitive-event attendee defaults remain off unless the organizer opts in.
- Free-event cancellation copy does not promise a refund for a zero-dollar RSVP. Creation explains free entry versus hosting-plan duration/capacity.

## Test evidence

Local Node 24 synthetic runs:

- Community suite: 1,085 passing (event creation, discovery, privacy, admission, RSVP/ticket and auth regression coverage).
- Ticket release suite: 918 passing.
- Lynk session suite: 83 passing.
- Real event-detail React DOM fixture: 26 passing, including protected attendee visibility, terminal/pending join controls and retry.
- Room preparation: 8 passing, including successful reuse, concurrent clicks, failure/retry, changed account/draft, timeout and late success.
- Real React + React Query entry/host hooks: single-flight, confirmed start, error/retry, stale event/session/unmount, guest routing and account-scoped roster.
- Real React chat/roster two-client DOM fixture: delayed admission, anonymous identity mapping, optimistic HTTP/realtime races, failed-send draft, account/room switch and stale callbacks.
- Actual RSVP issuance HTTP handler followed by event-room handler: guest denied before RSVP, $0 admission issuance, repeat idempotency, waiting, host start, admission; spoofed user ID, paid/private/expired rejection. Database/RPC responses are synthetic, not a real SQL execution claim.

CI adds Chromium and WebKit execution of the actual entry hooks. Existing event-ticket-widget browser CI also renders the actual event detail and production CSS at 390/768/1440 widths, checking the free Lynk action, hidden attendee section, 44px target and no overflow, with screenshots.

## Release / verification boundaries

This is a draft source fix, not a deployment. Shared backend changes require deployment of affected event/video edge functions together after review. Two source-only migrations are required because the generic expiry cron currently ends future linked rooms at their creation-based deadline. Approved rollout order must be: (1) apply `20261029145200_event_lynk_lifecycle_guards.sql` (atomic cleanup RPC and new-link guard), (2) deploy the updated create-event, event-lynk-room, process-event-lynk-lifecycle and affected room admission/token edges, (3) apply `20261029145300_event_lynk_scheduled_expiry.sql` to exclude linked Lynks from the generic sweep, (4) release web/native source and perform authenticated acceptance. Do not release removal of client room renewal as a complete fix before the backend rollout. Neither migration has been applied. Read-only production migration ledger confirmed prior event lifecycle, cron and chat-author privacy migrations are already applied; this is not runtime acceptance. Read-only `pg_get_functiondef` confirmed the premature-expiry cron definition in production. Aggregate impact audit found zero future linked events and zero current-window linked ended rooms, so no live event repair was indicated.

Local actual Chromium launch was blocked by sandbox process-socket EPERM; escalation failed before execution because the environment's bwrap setup could not create a read-only sessions path. Chromium and WebKit hook CI passed on initial head b0acd9fc. Event-ticket-widget browser CI passed; phone/tablet/desktop free-event screenshots were downloaded and visually inspected: free RSVP and Lynk action visible, no horizontal overflow, protected attendee section absent. Updated-head CI must still pass before acceptance.

Real signed-in host/guest sessions, physical iOS/Android audio/video permission handling, actual multiuser media/chat, and a production free event have **not** been tested by these fixtures. No claim of fully working live hardware is justified until that acceptance is performed. The actual PGlite SQL fixture executes both proposed migrations and verifies future-room survival, plan expiry, atomic member/count/token/lifecycle cleanup, audit idempotence, service-only grants, nullable legacy status, cancellation without a schedule, and ownership/private/type/expired/duplicate new-link guards. It is not a live database or concurrent-session load test.

Free attendee admission is not unlimited hosting. Existing host subscription limits remain unchanged (the free plan is capped; explicit-end events retain the existing five-minute policy). Confirm an appropriate hosting plan before a long afterparty.

Room preparation is not a cross-service transaction. A room-create response lost across a full reload can still leave an orphan private room; saved successful responses and same-tab pending requests are reused, but this patch does not claim server-side room-creation idempotency or cleanup. Previously published events already missing a room are not silently repaired or relinked. Unlinked prepared rooms that expired before a retry are rejected authoritatively; only an explicit room_unavailable refusal clears the same account/draft cache. Uncertain network failures retain it.


## Pre-release production schema correction

Read-only production metadata on October 29 verified the actual token columns are `is_revoked` and `revoked_at`, not `revoked`. The SQL fixture was corrected to mirror those columns first and reproduced `column "revoked" does not exist` against the prior migration. The cleanup now sets both the revocation flag and timestamp, preserving an existing timestamp, and the same fixture passes. The remaining referenced columns and state constraints were independently compared with production metadata. This is schema parity verification, not a live multiuser media test.
