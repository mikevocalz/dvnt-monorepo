# Watch Broadcast Fit — DVNT Apple Watch (PROMPT 7B)

How host **event broadcasts** reach the wrist. The watch is a **new presentation
surface over the existing pipeline** — no new server code. This doc is the as-is
contract → what the watch reuses verbatim.

Companion to [watch-app-fit.md](./watch-app-fit.md) (tickets-on-wrist). Same
target, App Group, and WCSession spine.

---

## 1. As-is broadcast contract (reused verbatim)

| Concern | Source of truth | Reused on the watch |
|---|---|---|
| Composer (host-only) | [broadcast-modal.tsx](../packages/app/components/events/broadcast-modal.tsx) | **Not on watch** — hosts compose on phone (a venue-critical message needs a real keyboard). Out of scope per boundary. |
| Send path | `sendEventBroadcast(eventId, message, audience, title?)` → [privileged/index.ts](../packages/app/lib/api/privileged/index.ts) | Untouched. |
| Edge function | `event-broadcast-message` → `{ notified, pushed, audience }`, rate-limited **3 / 5-min window** (429) | Untouched. |
| Audience | `BroadcastAudience = "all" \| "scanned" \| "unscanned"` | Scoped **server-side** (recipients filtered by ticket status). The watch renders only what the member received → honest by construction. |
| Delivery | (a) Expo push, (b) a `notifications` row → activity feed | The watch reads BOTH (push for the live moment, activity feed for history). |
| Activity feed | `useActivitiesQuery()` → `Activity[]` (type `event_broadcast`) | **The source for the in-app Broadcasts list.** |

### Push payload shape (what an `event_broadcast` push carries)

```jsonc
{
  "title": "<host title | event title>",
  "body":  "<the message, ≤400 chars, verbatim>",
  "data": { "type": "event_broadcast", "entityType": "event",
            "entityId": "<eventId>", "url": "https://dvntapp.live/e/<eventId>" },
  "sound": "default", "channelId": "default"
}
```

### Activity row shape (what the feed exposes per broadcast)

`Activity` (from [use-activities-query.ts](../packages/app/lib/hooks/use-activities-query.ts)):
`type: "event_broadcast"`, `event: { id, title }`, `payload: { title, body }`,
`user.username` (sender — usually the host/event, since broadcasts have no actor),
`createdAt` (ISO), `isRead`. `entityId` carries the eventId.

---

## 2. How broadcasts reach the watch — two paths, both wired

### Path A — Live push (member at the venue, wrist up) ✅ wired end-to-end
- A **custom long-look** is shipped: [BroadcastNotificationView.swift](../apps/mobile/targets/watch/BroadcastNotificationView.swift) — a SwiftUI `WKUserNotificationHostingController` registered via `WKNotificationScene(category: "dvnt_broadcast")` in [DVNTWatchApp.swift](../apps/mobile/targets/watch/DVNTWatchApp.swift). Renders **message as the hero** (large, true-black), event/host secondary, an intent glyph, and fires one deliberate haptic.
- **The push now carries the category.** watchOS selects a custom interface by matching the notification's **category identifier**. The `event-broadcast-message` edge function now stamps `categoryId: "dvnt_broadcast"` (→ APNs `aps.category`) on every Expo push, plus `data.entityTitle` so the long-look shows the event name without a lookup:

  ```ts
  // apps/mobile/supabase/functions/event-broadcast-message/index.ts
  const messages = tokens.map((t) => ({
    to: t.token, title, body,
    categoryId: "dvnt_broadcast",              // selects the watch long-look
    data: { type: "event_broadcast", entityType: "event",
            entityId: String(eventId), entityTitle: event.title, url },
    sound: "default", channelId: "default",
  }));
  ```

  This is additive and non-breaking — Android and older iOS ignore an unknown category. **⚠️ Requires deploying the function** (`supabase functions deploy event-broadcast-message`) for the change to take effect in production.

### Path B — In-app history (open the watch app) ✅ fully working, no server change
- A **Broadcasts list** inside the watch app: [BroadcastListView.swift](../apps/mobile/targets/watch/BroadcastListView.swift), reached from a home-list entry ("Messages from host", with unread badge) and, scoped to one event, from a ticket's QR screen (scroll below the QR → "Messages from host"). One broadcast = one full detail screen; the message is never truncated.
- Backed by [BroadcastStore.swift](../apps/mobile/targets/watch/BroadcastStore.swift), persisted in the watch App Group (`group.com.dvnt.app.watch`) so missed messages survive an unreachable phone.

---

## 3. Sync spine (reuses the ticket bridge)

```
useActivitiesQuery()  ──filter type==="event_broadcast"──▶  buildBroadcastEnvelope()
        │  (existing feed; no new network)                         │
        ▼                                                          ▼
use-watch-broadcast-sync.ts  ──▶  syncBroadcastsToWatch()  ──▶  WCSession applicationContext
   (mounted in (protected)/_layout.tsx, next to useWatchTicketSync)   { payload, broadcasts }
        │                                                          │
        └── App Group write (iPhone widget) ◀──┘                   ▼
                                              WatchConnectivityManager routes "broadcasts"
                                                       ▼
                                              BroadcastStore (App Group, watch)
```

- **One application-context slot, shared:** [watch-bridge.ts](../packages/app/src/watch/watch-bridge.ts) merges tickets + broadcasts into `{ payload, broadcasts }` and re-pushes both together, so syncing one never clobbers the other.
- **No new pipeline / no new network:** broadcasts ride the existing `useActivitiesQuery` poll; the envelope is pushed only when the set materially changes (new message or read-flip), capped at 40 newest to respect the ~262 KB application-context limit.
- **TS ⇄ Swift lockstep:** [watch-broadcast-payload.ts](../packages/app/src/watch/watch-broadcast-payload.ts) ↔ [BroadcastModels.swift](../apps/mobile/targets/watch/BroadcastModels.swift).

---

## 4. Polish decisions

- **Intent (styling only, text sacrosanct):** `urgent` / `directional` / `general` derived conservatively from the message text (e.g. "5 minutes"/"now"/"last call" → urgent; "to the front"/"VIP" → directional), picking glyph + accent + haptic weight. **Never rewrites or truncates the host's words.** Derived on the phone and re-derived defensively on the watch.
- **Haptics with restraint:** one deliberate `WKHapticType` per arrival (urgent → `.notification`, else `.click`). Batched by diffing the unread-id set, so a backfill of several messages at once fires **once**, not a machine-gun — mirroring the server's 3-per-window reality.
- **Audience honesty:** scoping is server-enforced; the member only ever holds rows they were in the audience for, so the watch needs no client-side audience filter and never shows a message meant for someone else. (Audience is *not* in the push/activity payload — see §5 if a "for people inside" label is ever wanted.)
- **Complication tie-in:** [DVNTWatchComplication.swift](../apps/mobile/targets/watch-complication/DVNTWatchComplication.swift) flips the rectangular family to "Host: …" when a broadcast landed in the last 3h (pure App Group read; no network).

---

## 5. Known gaps / deferred (honest)

- **Custom long-look is wired** (§2 Path A) — the edge function now stamps `categoryId`. It only goes live once the function is **deployed** (`supabase functions deploy event-broadcast-message`); the in-app list works regardless.
- **Audience label on a row** ("for people inside") is not possible today — `audience` is returned in the edge function's HTTP response but not written to the notification/activity row. Would require adding `data.audience` server-side (out of scope).
- **Live Activity bridge deferred.** The prompt asks a broadcast to update an active Live Activity. The **iOS Live Activity target is currently disabled** (`with-live-activity.js` — known launch crash; iOS branch commented out). Wiring broadcasts into it must wait until that target is re-enabled; not forked here, per boundary.
- **Watch-host-compose** is out of scope (dictation/scribble spike only).

---

## 6. Verification checklist (real watch + iPhone)

- [ ] Host sends `all` / `scanned` / `unscanned` from the existing composer; each reaches only the intended members' watches (server scoping).
- [ ] In-app Broadcasts list backfills missed messages from the shared store (phone reachable → live; unreachable → cached).
- [ ] From a ticket's QR screen, "Messages from host" shows only that event's broadcasts.
- [ ] Rapid sends fire the arrival haptic once (batched), not per-message.
- [ ] Complication shows "Host: …" for a broadcast in the last 3h.
- [ ] After adding `categoryId: "dvnt_broadcast"` server-side: the custom long-look renders (message hero + intent glyph), not the default mirror.
- [ ] No server code changed by this feature — `event-broadcast-message` and the activity stream untouched.
