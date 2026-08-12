# Realtime Media — Phase 0 Baseline & Decisions

*Prompt NN (“Separate the Stacks”), Phase-0 deliverable. 2026-08-12.*
*Every claim below is verified against master, the live database, installed
node_modules, or the linked first-party docs — file:line cited inline.
Skills/resources used: Fishjam MoQ tutorials + `moq-with-fishjam` explanation +
Fishjam AI-skill page (fishjam.swmansion.com/docs), `react-native-moq` npm/GitHub,
`expo-callkit-telecom` README/repo, local `~/Downloads/react-native-webgpu-main 2`
example suite.*

---

## Decision 1 — Call/Lynk split: **option (b), `room_kind` enum** (recommended)

**Why not a new `call_rooms` table (option a):** 19 edge functions query
`video_rooms` today — not just the video_* family but `delete-account`,
`report-content`, `sneaky-access-checkout`. A second table forks every one of
those code paths and the RLS that guards them. Option (c), separate schemas, is
option (a) with more ceremony.

**Why the enum is cheap and safe here:**
- The *client-side* coupling is tiny: 10 grep hits for `lynk|sneaky` in the
  entire call stack, concentrated in `audioSession.ts` (`startForLynk`,
  lines 298–360) plus one comment at `use-video-call.ts:619` and one path
  comment in `video-room.web.tsx:5`.
- The load-bearing authorization in `video_join_room/index.ts` (membership →
  banned/kicked status check at :229–252, host/co-host bypass at :246–247,
  `video_room_invites` lookup at :256–262, invite-only rejection at :266,
  capacity gates at :282+) is **shared** and stays byte-identical — the enum
  adds a filter, it does not touch the gate.

**Live-data facts that shape the migration:**
- `video_rooms` columns (live DB): id, created_by, title, topic, description,
  status, max_participants, participant_count, ended_at, created_at, updated_at,
  is_public, fishjam_room_id, uuid, has_video, sweet_spicy_mode, nsa_enabled,
  app_only.
- `call_signals.room_id` is `text` and stores **`video_rooms.uuid`** (verified:
  the 3 newest signals’ room_ids match rooms 377–379’s uuid values).
- Signals outlive rooms: 162 distinct `call_signals.room_id` vs 134 rooms —
  the backfill must tolerate dangling references (they’re fine; only existing
  rooms get stamped).
- **`is_public=false` does NOT uniquely identify calls** — private invite-only
  Lynks exist (the join function literally errors “This private Lynk is
  invite-only”). The reliable discriminator is call_signals:

```sql
-- additive, no destructive DML (standing rule)
alter table video_rooms add column room_kind text not null default 'lynk'
  check (room_kind in ('call','lynk'));
update video_rooms set room_kind = 'call'
 where uuid::text in (select room_id from call_signals);
```

**API split:** `call_create` / `call_join` become thin edge functions that set
and require `room_kind='call'` (internally reusing the exact join gate);
`video_list_rooms` adds `room_kind='lynk'` to its filter so a call can never
appear in Lynk **structurally**, not by flag discipline. RLS mirrors the same
predicate. `use-video-call.ts` moves off `videoApi.createRoom` onto the call
API; `audioSession.startForLynk` splits into `startForCall` (voice-processing/
AEC category) and `startForBroadcast` per WS-1.

**Rollback:** the column is additive with a default; dropping the two new edge
functions and pointing the client back at `videoApi` restores today exactly.
Exercised once on a branch per WS-1 accept.

**Boundary lint:** the WS-6 boundary lint (flipped to error in `80f6a64`) is the
enforcement point — add `features/sneaky-lynk/** ↛ call stack` and the inverse.

---

## Decision 2 — Web calling reach: **partial infra exists (~60%), not greenfield**

Already in the tree:
- `packages/app/lib/web-push.ts` — complete module: VAPID key, `subscribe()`
  registering `/push-sw.js`, `push_tokens` upsert (`platform:"web"`),
  `registerWebPushIfGranted()` already called on mount in
  `apps/web/src/app/(frontend)/feed/layout.tsx:5,9`.
- `apps/web/public/push-sw.js` — push → `showNotification`, click → focus/
  navigate.
- Server: `send_notification` reads `push_tokens`; its :222 comment records a
  DB trigger `call_signals → pg_net` for call push.

Gaps WS-2 must close:
1. **Two competing root-scope service workers** — `/sw.js` (registered by
   `register-sw.tsx:17-21`) and `/push-sw.js` (registered by web-push.ts).
   Merge to one before adding call handling.
2. No `data.type === 'call'` branch, no notification `actions`
   (answer/decline), no renotify/priority in `push-sw.js`.
3. No in-tab ring: `IncomingCallOverlay` (`features/call/ui/
   incoming-call-overlay.tsx:118`, subscription :137–168) is mounted **only**
   from the Expo Router protected layout
   (`features/routes/screens/(protected)/_layout.tsx:356`) — a tree the web
   app never imports. The `call_signals` INSERT subscription
   (`lib/api/call-signals.ts:172-200`) is web-safe as-is; it is simply never
   mounted on web. WS-2 mounts a web-language overlay in the web AppShell.

**Honest capability statement:** in-tab ringing works everywhere; ring-when-
closed requires Web Push — on iOS Safari that means the PWA installed to the
Home Screen (16.4+), and notification **actions** are not reliably rendered on
iOS, so answer/decline from the notification is Android/desktop-Chrome tier;
iOS-web gets “open to answer”.

---

## Decision 3 — `react-native-moq`: **GO** (all gates pass), and the duplicate is a **rescue, not a swap**

| Gate | Verdict | Evidence |
|---|---|---|
| New Architecture | PASS | lib “targets the RN New Architecture (Fabric / TurboModules)” (RN-publishing tutorial); `newArchEnabled=true` (android/gradle.properties:38) |
| iOS floor 16+ | PASS | ours 17.0 (app.config.js:96, :402) |
| Android floor API 30+ | PASS | minSdk 30 (app.config.js:420; shipped `562f820`) |
| Expo/CNG | PASS (verify in first dev build) | plain `npm install` + autolinking per tutorial; no config plugin required; permissions are the host app’s job — we already hold camera/mic for calls |
| Maturity | CAUTION | npm `react-native-moq` latest **0.2.0** (2026-07-10); releases 0.0.1→0.2.0 since 2025-10; SM Labs, active |
| Interop native↔web | PASS | “A stream published from the browser with `@moq/publish` can be watched with `react-native-moq`, and vice versa” (RN-subscribing tutorial) |
| Version alignment | PASS | tutorials pinned at docs 0.29.0 = our Fishjam SDK line (all `@fishjam-cloud/*` at 0.29.0); `@moq/lite ^0.3.0`, `@moq/publish ^0.2.14`, `@moq/watch ^0.2.16` installed |
| Tokens | PASS (already built) | `lynk-moq-token` mints `createMoqToken({publishPath\|subscribePath})` via `npm:@fishjam-cloud/js-server-sdk`, publish = `lynk/${roomId}/${peerId}` (specific), subscribe = `lynk/${roomId}` (broad), behind the same session + role/ban gate as `video_join_room`; relay root-namespace rule matches the explanation doc (FISHJAM_ID never in paths) |

Biggest risk: 0.2.0 is young. Mitigation: WHIP/WHEP stays live through burn-in
(see delete list), and the transport seam means a revert is hook-internal.

**Duplication verdict (git-proven):** the MoQ screens
(`features/screens/(protected)/lynk/[roomId]/{web,native}.tsx`) and the entire
`lib/lynk/` MoQ layer date to the **initial commit (2026-06-16, `8f55bd0`)**
and have never been touched since except the mechanical WS-6 move (`4c770b0`).
They were **never routed on web**; on native they ARE routed — but at a
parallel experimental route `/(protected)/lynk/[roomId]`
(`apps/mobile/app/(protected)/lynk/[roomId].tsx`), not the product route.
The product screens have continuous active development: web
`features/sneaky-lynk/screens/room.web.tsx` (2,088 lines, last touched
2026-08-08) and native
`features/routes/screens/(protected)/sneaky-lynk/room/[id].tsx` (2,845 lines,
on `@fishjam-cloud/react-native-client` `useCamera`/`useMicrophone`).

→ **Keep the routed product screens; swap their media layer to the
`useLynkBroadcast`/`useLynkViewer` hooks** (web hooks already MoQ; native hooks
flip WHIP→`react-native-moq` internally). The genesis screens are the rescue
*source* for wiring patterns, then deleted.

**The mock:** `rtc/fishjamClient.ts` now lives at
`features/sneaky-lynk/rtc/fishjamClient.ts`; its only importer is
`hooks/useSneakyLynkRoom.ts`, whose only reference is the
`features/sneaky-lynk/index.ts` barrel — no screen consumes it. Dead chain.

**Delete list (post burn-in unless marked now):**
| Path | When | Why safe |
|---|---|---|
| `features/sneaky-lynk/rtc/fishjamClient.ts` + `hooks/useSneakyLynkRoom.ts` + barrel exports | **now** (WS-3a) | mock; no screen consumers (verify barrel named-import grep at delete time) |
| `features/screens/(protected)/lynk/[roomId]/{web,native}.tsx` + `apps/mobile/app/(protected)/lynk/[roomId].tsx` | cutover | genesis screens; product screens absorb their media wiring |
| WHIP internals of `useLynkBroadcast.native.ts` / `useLynkViewer.native.ts` (`useLivestreamStreamer`), `video_room_members.livestream_id`, poll discovery | after burn-in | fallback until MoQ soak passes |
| `packages/ui/src/video/moqPlayerHtml.ts` | after burn-in | superseded by real subscriber hooks |
| `lynk-livestream-token` edge fn | after burn-in | replaced by `lynk-moq-token` |

---

## Decision 4 — `expo-callkit-telecom`: **phased adoption** (parity mostly there; 5 APIs need source verification)

Package: v0.4.0 (npm 2026-06-16; repo pushed 2026-07-30; 42★, 6 open issues,
21 releases). Swift/Kotlin Expo module wrapping **CallKit (iOS) + Jetpack
Core-Telecom (Android)** with a config plugin. Floors: iOS 15.1 (ours 17),
Android minSdk 26 (ours 30) — both pass.

**The headline architectural win (and the crash-surface link):** the module
“parses the payload natively — **before JS is running** — and reports the call
to the OS … calls can be reported from a terminated state.” Today our
`AppDelegate+VoIPPush.m` does report to CallKit natively (:61, before JS —
PushKit-correct), but the *call handling* still boots the full RN bundle
headless on every VoIP push — which is exactly the surface where production
builds 1.0.315/1.0.316 are crashing (all crash reports `Role: Non UI`,
SIGABRT ~0.9s after launch). WS-5 shrinks that surface.

Parity vs the 19 RNCallKeep APIs we consume (`features/services/callkeep/`):

| Ours | Theirs | Status |
|---|---|---|
| setup / registerAndroidEvents | config plugin + module init | ✓ (different shape) |
| displayIncomingCall / reportNewIncomingCall | `reportIncomingCall` | ✓ |
| answer flow + events | `answerCall`, `addCallAnsweredListener`, `fulfillIncomingCallConnected`, `failIncomingCallConnected` | ✓ (richer) |
| endCall / reportEndCallWithUUID | `endCall` / `reportCallEnded` | ✓ |
| startCall / reportConnectedOutgoingCallWithUUID | `startOutgoingCall` / `reportOutgoingCallConnected` | ✓ |
| setMutedCall | `setMuted` (+ setHeld, reportVideo, playDTMF) | ✓ |
| getInitialEvents / clearInitialEvents | obviated — native payload parsing covers cold start | ✓ better |
| VoIP push (RNVoipPushNotificationManager + custom `AppDelegate+VoIPPush.m` + `NotificationListener.tsx`) | `registerVoIPPush` / `useVoIPPushToken` (PushKit iOS, **FCM data messages** Android) | ✓ better — retires our plugin AND the Android listener |
| `endAllCalls` | not in README | **verify in source** |
| `reportConnectingOutgoingCallWithUUID` | not in README | **verify** |
| `setAvailable` | not in README | **verify** |
| `setCurrentCallActive` | closest: `fulfillIncomingCallConnected` | **verify semantics** |
| `canMakeMultipleCalls` / `updateDisplay` / `backToForeground` | not in README (Core-Telecom full-screen intent may obviate backToForeground) | **verify** |

**`patch-callkeep.sh` reason:** duplicate `@ReactMethod` overloads crash
TurboModule interop (callkeep #857) — the script comments out two 3-arg
overloads on every install. An Expo Module has no `@ReactMethod` → the patch
(and `@config-plugins/react-native-callkeep`) is obviated entirely.

**Phased plan:** adapter behind `useCallKeepCoordinator`’s existing interface;
verify the 5 unlisted APIs against `src/` before cutover; if any is real and
missing, ship the covered surface behind a flag and retain callkeep only for
the remainder (per prompt).

---

## Decision 5 — GPU reactions: **TypeGPU + instanced particles, overlay surface**, with two Phase-0 corrections

**Package reconciliation (resolve before any GPU code):** node_modules contains
**both** `react-native-wgpu` (declared `^0.5.11` in `apps/mobile/package.json:174`)
and `react-native-webgpu` (declared `^0.5.15` in `packages/app/package.json:349`)
— two copies of the same lib, both resolving 0.5.15. All source imports the
successor name. Fix: drop the `react-native-wgpu` declaration from apps/mobile;
one line + lockfile. **TypeGPU is not installed anywhere** — adding `typegpu`
is a new (pure-TS, no native module) dependency; recommended per the spec.

**Honest-state corrections to the prompt’s premises:**
- “Fifty reactions is fifty views” — today reactions are **hard-capped at 6**
  (`useRoomReactions.ts:45`, `slice(-5)` + incoming). Native renders ~4 nodes ×
  6 = ~24 animated nodes (RN `Animated`, 4 values each, started inside a
  `useRef` initializer — a render-body side effect worth fixing in passing);
  web renders one `<span>` per reaction with a CSS keyframe, deterministic
  lane (`room.web.tsx:519-541`). The 50-concurrent target therefore means
  **raising the cap on the GPU path only**; the RN/DOM fallback keeps cap 6.
- `WorkletRenderLoop` is a **misnomer**: plain JS-thread rAF, no worklet, no
  Reanimated shared values, and a **singleton** (second `start()` is a silent
  no-op) — one owner app-wide. `GpuRuntime` has **no canvas/context/present
  management**; the consumer owns `Canvas` + `getContext("webgpu")` +
  `context.present()` per frame (WeatherGPUEngine is the reference, currently
  commented out of the layout at `(protected)/_layout.tsx:358` — so nothing
  mounts GPU at runtime today).

**Design:** one render pipeline, one pre-allocated ring buffer of instance data
`{atlasIndex: u32, spawnTimeMs: f32, lane: f32, driftSeed: f32, isOwn: u32}`,
emoji atlas texture (6 glyphs today, rasterized once), quad expansion in the
vertex shader from `@builtin(instance_index)`, motion = pure function of
`(time - spawnTime)` — so per-frame CPU work is ONE `queue.writeBuffer` of new
spawns and one uniform write, `draw(6, liveCount)`. Authored with TypeGPU typed
schemas. Overlay surface (own `Canvas` above the room UI), NOT composited into
the video path — reactions must never touch the media pipeline. Own rAF loop
scoped to the room screen (don’t fight the singleton), stopped when the room
is backgrounded/off-screen. The local `react-native-webgpu-main 2`
`Particles` example is the device-pattern reference (50k instances,
`stepMode:"instance"`, compute-advance) — with one anti-pattern to avoid: it
allocates fresh `Float32Array`s per frame; ours hoists them (zero-per-frame-
allocation law). Web runs the same WGSL through browser WebGPU; fallback is
the exact current RN/DOM path (`isWebGPUAvailable() === false` branch).

Transport (`useRoomReactions` Supabase broadcast, 2400 ms TTL, payload
`{id, roomId, userId, senderLabel, emoji, createdAt}` + local `isOwn`) is
untouched.

---

## Workstream order (unchanged from the prompt)

WS-1 split → WS-2 web ringing → WS-3 MoQ both platforms → WS-4 GPU reactions →
WS-5 CallKit/Telecom. WS-5’s parity-verification step can run any time; its
cutover waits for a stable call domain from WS-1.

## Approval asks

1. Option (b) `room_kind` enum + `call_create`/`call_join` split — approve?
2. `react-native-moq` GO on native (WHIP retained through burn-in) — approve?
3. Routed screens keep their UI; genesis MoQ screens deleted after rescue — approve?
4. `expo-callkit-telecom` phased behind the coordinator interface — approve?
5. Add `typegpu` (pure-TS dep) + drop the duplicate `react-native-wgpu`
   declaration — approve?
