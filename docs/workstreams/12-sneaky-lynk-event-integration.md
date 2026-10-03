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

## Lifecycle scheduling (as built)

`process-event-lynk-lifecycle` runs from pg_cron every 5 minutes, triggered the same way as the 3-hour reminder emails:

- Job `event-lynk-lifecycle-every-5min` runs `select public.cron_event_lynk_lifecycle_sweep();` (migration `20261003160000_event_lynk_lifecycle_cron.sql`).
- The sweep reads `CRON_SECRET` from Vault and calls the function with an `x-cron-secret` header, like `cron_event_reminder_sweep`. Nothing secret is stored in `cron.job`.
- The function returns 500 when `CRON_SECRET` is unset and 401 on a missing or wrong header. A Bearer token is no longer accepted.
- A failed `sync_event_lynk_lifecycle` call or room update is logged with its event id. The sweep moves on to the next event and returns 500 with the failed ids, so the failure shows in `net._http_response`.

Why 5 minutes: the sweep is what opens a precreated `scheduled` room at the event's start time, so the interval is the longest a ticket holder can wait on the countdown after the advertised start. Ending rooms only has to beat the 24h listing cap.

`room_invite` was missing from the live `enum_notifications_type` (checked read-only on 2026-10-03), so every `room_invite` notification insert failed, on master too. Migration `20261003155900_notifications_room_invite_type.sql` adds it in a file of its own because `ALTER TYPE ... ADD VALUE` cannot share a transaction with a statement that uses the value. The web and native Activity renderers already had `room_invite` copy and routing. The invite row now carries `actor_id`, so it shows which host sent it.

### Deploy order

1. Migrations, in filename order: `20261002210000_event_lynk_lifecycle.sql` (table + `sync_event_lynk_lifecycle`), `20261003155900_notifications_room_invite_type.sql`, then `20261003160000_event_lynk_lifecycle_cron.sql` last.
2. Deploy `process-event-lynk-lifecycle` and `event-lynk-invite` before the cron job's first run, with `CRON_SECRET` set to the Vault value. If the cron migration lands first, the runs before the function deploy hit a 404 or the old Bearer check and get 401; nothing is written, and the next run after the deploy catches up.

Safest order: lifecycle migration, enum migration, both functions, cron migration.

Tests: `apps/mobile/supabase/functions/process-event-lynk-lifecycle/index.test.cjs` (in `pnpm test:community`).
