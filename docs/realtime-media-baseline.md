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

---

## Progress log

**WS-1 (`da41ee6`) — done.** Migration is live: `video_rooms.room_kind` present
with default `'lynk'`, backfill stamped 58 `call` / 76 `lynk`, and
`video_rooms_kind_status_idx` exists. `call_create` + `call_join` deployed
(v1, ACTIVE, `verify_jwt=false`; all 154 functions still `verify_jwt=false`).

**WS-2 (`87d46e9`) — done.** One service worker, call Accept/Decline actions,
`IncomingCallOverlay` mounted on web. Backend is live: `internal_fn_secrets`
exists, `call_signals_push_trigger` authenticates with `x-internal-secret`, and
`send_notification` is deployed at v58.

**WS-3a — done.** Dead mock chain deleted (`rtc/fishjamClient.ts`,
`hooks/useSneakyLynkRoom.ts`, barrel export). Native transport swapped from
Fishjam WHIP/WHEP to `react-native-moq@0.2.0`, so both platforms now speak MoQ
and interop. Correction to the Decision-3 delete list: `lib/lynk/livestreamToken.ts`
and `LivestreamTile.native.tsx` were deleted **now**, not after burn-in — the
hook rewrite left them with zero importers, and rollback is a single revert of
the WS-3a commit, which restores them together with the WHIP hooks.

**WS-3b — not started.** The routed product screens
(`features/sneaky-lynk/screens/room.web.tsx`, 2,088 lines;
`features/routes/screens/(protected)/sneaky-lynk/room/[id].tsx`, 2,845 lines)
still call `@fishjam-cloud/react-native-client` directly and do **not** consume
`useLynkBroadcast`/`useLynkViewer`. Decision 3's "swap the media layer inside
the hooks" only reaches the product once those screens are moved onto the hook
seam. Until then the MoQ path is exercised only by the genesis screens at
`features/screens/(protected)/lynk/[roomId]/`, which is the burn-in surface.

**Native build note.** `react-native-moq` is a native module (iOS 16.0 floor vs
our 17.0; Android minSdk 30 vs our 30; SPM `moq-kit` 0.3.0 via `spm_dependency`).
A new dev build is required before the native MoQ path can run at all.

**WS-4 — built, not yet run on a device.** GPU reactions per Decision 5.

Package reconciliation done first, as the decision required: the duplicate
`react-native-wgpu` declaration is gone (every import already used the
successor name), `react-native-webgpu` is declared once per consumer and
bumped 0.5.15 → **0.8.2**, and `typegpu@0.12.0` is added. The bump happened
now rather than later because nothing mounts GPU at runtime today
(`WeatherGPUEngine` is still commented out of `(protected)/_layout.tsx`), so
the blast radius is zero — and writing new GPU code against a stale API only
to bump afterwards is the more expensive order. Peers check out: RN 0.86 vs
>=0.81, Reanimated 4.5.3 vs >=4.2.1, worklets 0.11.3 vs >=0.7.2.

Shape as designed: one pipeline, one pre-allocated ring of 64 instances, motion
as a pure function of `(now - spawnTime)` in the vertex shader, so per frame the
CPU does one uniform write and one `draw(6, 64)`. Spawning writes 20 bytes.
Scratch buffers are hoisted (zero-per-frame-allocation law). TypeGPU owns the
schemas — `sizeOf(ReactionInstance)` is the stride authority — and the shader
stays plain WGSL because web and native run the same source.

Deviations from the decision text, both deliberate:
- Draws the full ring every frame and collapses expired instances to a
  degenerate quad in the vertex shader, instead of `draw(6, liveCount)`. 64
  degenerate quads is free and it removes a CPU-side liveness count. Marked
  with a `ponytail:` comment naming the upgrade path.
- The atlas is rasterized from each screen's **existing** palette rather than a
  new shared one. Native (`ControlsBar`) and web (`room.web.tsx`) currently ship
  *different* six-emoji sets. Unifying them is a visible product change, so it
  is flagged here rather than made silently.

Cap: `GPU_REACTION_CAP = 50` applies only once the overlay reports it has a
device, an atlas AND a pipeline; any failure in that chain leaves the RN/DOM
path mounted at the old cap of 6. Transport (`useRoomReactions`) is unchanged
apart from the cap becoming a parameter.

Fixed in passing (flagged by Decision 5): `FloatingReaction` started its
animation inside a `useRef` initializer — a render-body side effect that
double-fired `onComplete` on any discarded render. Now an effect.

Evidence: `@dvnt/app` and `web` typecheck clean; the layout contract between
`writeInstance`, the TypeGPU schema and the WGSL struct has 4 passing
assertions (`features/gpu/reactions/engine.test.ts`, run with `tsx/esm`).
**What is NOT verified: a single rendered frame.** No device, simulator, or
browser has run this path. Treat the visual result as unproven until it does.

`apps/web` pins TypeScript 5.8.3, whose `lib.dom.d.ts` predates WebGPU, so it
now carries `@webgpu/types@0.1.65` — pinned to the exact version
`react-native-webgpu` ships against, so the two can't disagree.

**WS-5 parity verification — done. The five unknowns resolve to NO BLOCKER.**

Verified against the published `expo-callkit-telecom@0.4.0` tarball (npm), not
the README: the complete native surface was enumerated from the Swift and
Kotlin `Function`/`AsyncFunction` registrations, which is the authoritative
list. iOS and Android expose the same set apart from
`failIncomingCallConnected` (iOS only).

| Ours | Theirs | Verified verdict |
|---|---|---|
| `endAllCalls` | absent, both platforms | **Composable, not missing.** The module models exactly one live call (`CallStore.firstSession`; `getActiveCallSession(): CallSession \| null`), so this is `endCall(activeSession.id)` — an adapter one-liner. |
| `reportConnectingOutgoingCallWithUUID` | absent | **Real gap, cosmetic.** `reportOutgoingCallConnected` calls `provider.reportOutgoingCall(with:connectedAt:)` (CallManager.swift:510); nothing anywhere passes `startedConnectingAt:`. iOS never shows the "connecting…" phase. No functional loss. |
| `setAvailable` | absent | **Obviated.** A ConnectionService concept; Core-Telecom registration is declarative. |
| `setCurrentCallActive` | `fulfillIncomingCallConnected` | **Semantics match, with a trap.** It resolves the pending `CXAnswerCallAction` *and* sets `status=.connected` + `connectedAt` (CallManager.swift:466-479) — it is not a free-standing "mark active" and it fails if the fulfil request already timed out. Note the JS wrapper (`fulfillIncomingCallConnected`) and the native function (`fulfillIncomingCallAnswered`) have **different names**; logs will disagree with source. |
| `canMakeMultipleCalls` | absent, and not configurable | **A match, not a gap.** `maximumCallGroups = 1`, `maximumCallsPerCallGroup = 1` are hard-coded (CallManager.swift:59-60) — and we already call `canMakeMultipleCalls(false)` (callkeep.ts:281). Their constraint is our existing configuration. |
| `updateDisplay` | absent | Real gap — caller name/handle can't be revised after `reportIncomingCall`. |
| `backToForeground` | absent | **Obviated on Android** by `setFullScreenIntent(..., true)` (CallNotificationManager.kt:226/262/304). |

**The finding that settles the phasing:** of those seven APIs, only
`endAllCalls` has any consumer outside our own wrapper — three sites
(`lib/supabase/privileged.ts:104`, `lib/hooks/use-video-call.ts:56,1092`) —
and it is trivially composable. `updateDisplay`, `backToForeground`,
`setAvailable`, `setCurrentCallActive`, `reportConnectingOutgoingCallWithUUID`
and `canMakeMultipleCalls` have **zero** consumers outside
`features/services/callkeep/`: they are surface we wrote and never called. The
gaps therefore cost nothing, and the "ship the covered surface behind a flag,
retain callkeep for the remainder" fallback is not needed — the covered
surface is the whole used surface.

One caveat found on the way, unrelated to parity but on the cutover path:
`packages/app/features/services/callkeep/callkeep.ts` and
`apps/mobile/src/services/callkeep/callkeep.ts` are **byte-identical copies**,
and `apps/mobile/lib/supabase/privileged.ts:66` dynamically imports the
apps/mobile one while `packages/app/lib/supabase/privileged.ts:104` imports the
packages/app one. A cutover that edits only one leaves the other live. Collapse
them to one module before the adapter lands, not after.

Still unverified for WS-5 (needs a build, not a source read): the claim that
native-before-JS call reporting shrinks the 1.0.315/1.0.316 headless-boot
SIGABRT surface. That is the actual reason for the migration and it can only be
confirmed on a device.
