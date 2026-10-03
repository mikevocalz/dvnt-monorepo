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

## Starting the room (as built)

The room works like a Zoom meeting: it opens when a host starts it or joins it, never on the clock.

- **Host** means the event owner, or a co-organizer whose staff invite is accepted and whose role is `admin` or `editor` (`_shared/event-lynk-host.ts`, also used by `event-lynk-invite`). A pending invite or a `scanner` is not a host.
- **Start**: `event-lynk-room` with `action: "start"`. Moves `event_lynk_lifecycle.state` from `scheduled`/`ready` to `live` and records `live_at` and `started_by`. A host may start at any time before the event ends. Refused (409) for a cancelled event, an ended event, or a room whose `video_rooms.status` is not `open`. Non-hosts get 403. A second start answers 200 with `started: false`. Every read that decides access fails closed with a 500.
- **Host joins = Start**: a host who joins their own event room starts it, with the same lifecycle change as `action: "start"` (shared code in `_shared/event-lynk-start.ts`, idempotent). This happens in `video_join_room` after the peer token is minted and in `event-lynk-room` `action: "wait"`. In `video_join_room` a failed start is logged and never fails the join. An accepted `scanner` co-organizer still gets in without waiting but does not start the room, and a guest's join never starts it.
- **Waiting room**: before the start, `video_join_room` (and the other token functions through `resolveEventRoomAccess`) answers ticket holders and invitees with `conflict` / `waiting_for_host`. The native and web room screens show "Waiting for the host to start" and heartbeat `event-lynk-room` `action: "wait"` every 5 s, which upserts `event_lynk_waiting (event_id, user_id, joined_at, last_seen_at, admitted_at)`. That table has RLS on and is granted to `service_role` only. A guest with no ticket or invite is refused instead of parked.
- **Auto-admit**: start marks every waiting row `admitted_at`. Each waiting client sees `admitted: true` on its next heartbeat and re-runs its normal join, so bans, `max_participants`, and verified admission in `video_join_room` still apply. Start never writes `video_room_members`. A guest who arrives after the start goes straight in.
- **Host waiting list**: `action: "list"` returns the guests seen in the last 30 s with name, avatar and `joined_at`. The event page shows it to hosts with a count and a **Start Lynk** button (native: `EventLynkHostPanel`, LegendList; web: the Sneaky Lynk section of `event-detail.web.tsx`). It polls every 5 s until the room is live; there is no realtime channel because the table is service-role only. Start is optimistic and rolls back with an error toast.
- **Live list**: `video_list_rooms` shows an event room as live only when its lifecycle row is `live`.
- The 5-minute cron (`process-event-lynk-lifecycle`) no longer opens rooms. It syncs lifecycle rows and ends rooms whose event ended or was cancelled. `sync_event_lynk_lifecycle` never assigns `live`; it keeps a host-started row live until the event ends or is cancelled.

### Two hosts on the stage

With a co-host in the room the top of the stage splits into two tiles side by side; one host is a single tile. `hostStageLayout` in `ui/stage-layout.ts` computes both from the same stage box, so the stage does not change size when a co-host joins or leaves. On web and on tablets (width >= 700) the stage is capped at 768 px, the app's `max-w-3xl` content column (`MAX_SHEET_WIDTH` in `lib/ui/sheet-metrics.ts`), and centred. Phones stay full width. Native animates the split with a Reanimated `LinearTransition` plus fade in and out; web transitions the tile width in CSS (off under reduced motion). Listeners below are unchanged. Not verified on a device or in a browser.

### Invite copy

A `room_invite` row from `event-lynk-invite` carries `entity_type = 'event'`, `entity_id`, and `entity_payload.event_title`. Activity on web and native reads "invited you to {event title}'s Sneaky Lynk." from the batched events lookup it already does, falling back to the payload title, then to "invited you to a Sneaky Lynk."

## Lifecycle scheduling (as built)

`process-event-lynk-lifecycle` runs from pg_cron every 5 minutes, triggered the same way as the 3-hour reminder emails:

The sweep never opens a room (see above).

- Job `event-lynk-lifecycle-every-5min` runs `select public.cron_event_lynk_lifecycle_sweep();` (migration `20261003160000_event_lynk_lifecycle_cron.sql`).
- The sweep reads `CRON_SECRET` from Vault and calls the function with an `x-cron-secret` header, like `cron_event_reminder_sweep`. Nothing secret is stored in `cron.job`.
- The function returns 500 when `CRON_SECRET` is unset and 401 on a missing or wrong header. A Bearer token is no longer accepted.
- A failed `sync_event_lynk_lifecycle` call or room update is logged with its event id. The sweep moves on to the next event and returns 500 with the failed ids, so the failure shows in `net._http_response`.

Why 5 minutes: it bounds how long a cancelled event's room stays joinable. Ending rooms only has to beat the 24h listing cap.

`room_invite` was missing from the live `enum_notifications_type` (checked read-only on 2026-10-03), so every `room_invite` notification insert failed, on master too. Migration `20261003155900_notifications_room_invite_type.sql` adds it in a file of its own because `ALTER TYPE ... ADD VALUE` cannot share a transaction with a statement that uses the value. The web and native Activity renderers already had `room_invite` copy and routing. The invite row now carries `actor_id`, so it shows which host sent it.

### Deploy order

`event_lynk_lifecycle` and `event_lynk_waiting` do not exist on the live project yet (checked read-only on 2026-10-03), so `20261002210000` was edited in place rather than followed by a second migration.

1. Migrations in filename order: `20261002210000_event_lynk_lifecycle.sql` (both tables + `sync_event_lynk_lifecycle`), then `20261003155900_notifications_room_invite_type.sql`.
2. Deploy `event-lynk-room` (new; `verify_jwt = false` is pinned in `config.toml`).
3. Deploy the functions that read `event_lynk_lifecycle`: `video_join_room`, `video_refresh_token`, `lynk-moq-token`, `lynk-livestream-token` (all through `_shared/event-access.ts`) and `video_list_rooms`. They must not ship before step 1: the lifecycle read fails closed, so guests would get errors instead of the waiting room.
4. Deploy `event-lynk-invite`, `process-event-lynk-lifecycle` (with `CRON_SECRET` set to the Vault value) and `video_create_room`, which now applies verified admission before a room is created (`video_refresh_token` gets the same gate in step 3).
5. `20261003160000_event_lynk_lifecycle_cron.sql` last.
6. Ship the app (native + web) after the functions. An older app that gets `waiting_for_host` shows its generic join error, not the waiting room.

At deploy, `20261002210000` marks every event already in progress (`start_date <= now() < COALESCE(end_date, start_date + 6h)`, not cancelled or deleted, with a Lynk room no other event shares) as `live` with `started_by` NULL, so guests who were joining on the old clock rule are not parked in a waiting room. Future events get no row and stay `scheduled` until a host starts or joins. The selection was checked read-only on 2026-10-03 against stub rows in a CTE on the live project; the INSERT itself has not run anywhere. Live had 2 events with a Lynk room and 0 in progress that day.

Tests (in `pnpm test:community` unless noted): `event-lynk-room/index.test.cjs`, `process-event-lynk-lifecycle/index.test.cjs`, `event-lynk-invite/index.test.cjs`, `packages/app/lib/events/event-access.test.ts`, `packages/app/lib/events/event-lynk.test.ts`, and `packages/app/features/sneaky-lynk/ui/stage-layout.test.ts` (`pnpm test:lynk-session`).
