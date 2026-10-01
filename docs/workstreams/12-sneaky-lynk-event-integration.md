# DVNT Workstream 12 — Ticketed Sneaky Lynk event lifecycle

## Goal
Make a ticketed Sneaky Lynk event a deterministic scheduled live experience: room prepared ahead of time, not publicly live early, automatically opens at event time, ticket/invite deep links land in the correct room, host can invite people during the session, and stale listings disappear.

## Existing foundation
- video room creation/joining exists
- ticket/schedule access checks exist
- web join/rejoin and host-disconnect bugs have been repaired
- room expiry sweep exists
- host share control exists
- private event invite/share flow exists

## Scope

### 1. Event ↔ room identity
Each Sneaky Lynk event owns a stable scheduled room record created idempotently before start.
Store/link:
- event ID
- room ID
- scheduled start/end
- visibility/access mode
- lifecycle state

Creating/editing the event must not mint multiple rooms.

### 2. Lifecycle states
Suggested:
- scheduled
- ready
- live
- ended
- cancelled

"scheduled/ready" must never appear as a currently live Lynk.

Transitions are server-owned and based on canonical event time.

### 3. Precreation
Prepare room credentials/state early enough for reliable start, but:
- no participant admission before allowed window unless host preview policy permits
- no public live indicator early
- no dead-link if attendee opens invite shortly before start; show countdown/waiting state

### 4. Start and end
At start:
- scheduled job or first-authorized-open CAS moves room live
- host can join/reconnect
- eligible ticket/invitee joins

At end:
- room ends according to event/session policy
- listing remains only for the defined post-session window
- hard cap: no more than 24h in Sneaky Lynk list after end, preferably much shorter for a "live" list
- room runtime cleanup and DB lifecycle stay consistent

### 5. Access
Server decision combines:
- host/cohost
- valid ticket
- explicit invite for private event
- refund/void status
- verification/adult policy
- event state/time gate

No client-only entitlement check.

### 6. Deep links
Invitation/ticket/event CTA resolves:
- before start → waiting/countdown
- live → room
- ended → event/post-event surface
- invalid/refunded → clear access reason

### 7. In-room Invite People
Host/cohost action:
- searchable DVNT member picker
- filter/block invalid targets
- batch invite
- Activity/push/DM deep link
- realtime attendee appearance
- invite does not bypass event privacy/ticket rules unless the invitation itself is the authorized guest grant

### 8. E2E proof
Create a real test event and capture evidence for host + invitee/ticket holder across the full timeline.

## Acceptance criteria
- [ ] Event creation produces exactly one stable scheduled room.
- [ ] Scheduled room never appears falsely live.
- [ ] Eligible attendee opening early sees waiting/countdown, not "closed".
- [ ] At start, deep link opens the live room without manual room recreation.
- [ ] Refunded/void ticket cannot join.
- [ ] Host reconnect does not end the room.
- [ ] In-room invite reaches recipient and deep-links correctly.
- [ ] Ended room disappears from live listing and never remains beyond 24h.
- [ ] Lifecycle survives cron/retry/concurrent host opens.

## Test matrix
- public ticketed event
- private invited event
- free/paid/comp ticket
- early/at-start/late join
- LA/NY timezone
- host disconnect/reconnect
- refunded ticket
- invite during live room
- room ended + listing cleanup
