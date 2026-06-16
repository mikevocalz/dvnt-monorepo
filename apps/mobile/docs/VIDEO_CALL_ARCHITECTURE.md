# Call Architecture — Never-Black-Screen, Never-Silent-Audio

> **Status**: Enforced  
> **Last updated**: 2026-02-08  
> **Stack**: Expo Dev Client · Fishjam WebRTC SDK · Supabase Edge Functions · Zustand  
> **Principle**: Audio is FIRST-CLASS, not an afterthought. Video is OPTIONAL, not required.

---

## 1. Room & Token Invariants

### Rules

1. Rooms MUST be created server-side (`video_create_room`) BEFORE token issuance
2. Tokens are minted by `video_join_room` which creates a Fishjam peer
3. Tokens include: `roomId`, `userId`, `role`, `jti`, `expiresAt` (1 hour TTL)
4. Edge functions NEVER return empty 200 — always `{ ok: true/false, data?, error? }`

### Edge Function Contract

```
video_create_room → { ok, data: { room: { id (UUID), title, ... } } }
video_join_room   → { ok, data: { room, token, peer, user, expiresAt } }
```

### Required Environment Variables

```
SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
FISHJAM_APP_ID, FISHJAM_API_KEY
DATABASE_URL (or SUPABASE_DB_URL)
BETTER_AUTH_SECRET
```

### Failure Modes

| Failure          | Log                                      | HTTP |
| ---------------- | ---------------------------------------- | ---- |
| No auth header   | `[video_*] Auth error`                   | 401  |
| Session expired  | `[video_*] Session expired`              | 401  |
| Room not found   | `[video_*] Room not found`               | 404  |
| Fishjam API down | `[video_*] Fishjam room creation failed` | 500  |
| Rate limited     | `[video_*] Too many attempts`            | 429  |

---

## 2. Permission Gating (CRITICAL)

### Rule

**NO ROOM JOIN OCCURS UNTIL permissions are granted.**

### State Machine (`useMediaPermissions`)

```
pending → requesting → granted ✓
                     → denied  ✗ (show UI, link to Settings)
```

### Implementation

- `useMediaPermissions` hook in `src/video/hooks/useMediaPermissions.ts`
- Uses `react-native-vision-camera` permission hooks
- Updates Zustand store: `cameraPermission`, `micPermission`
- Sets `callPhase = "perms_denied"` on denial

### UI States

| State     | UI                                                     |
| --------- | ------------------------------------------------------ |
| `pending` | Spinner + "Requesting permissions..."                  |
| `granted` | Proceed to room join                                   |
| `denied`  | Full-screen error + "Open Settings" button + "Go Back" |

---

## 3. Room Join Order (NON-NEGOTIABLE)

```
1. requestPermissions(callType)     → BLOCKS on denial
2. videoApi.createRoom()            → callPhase = "creating_room"
3. videoApi.joinRoom(roomId)        → callPhase = "joining_room"
4. fishjam.joinRoom({ peerToken })  → callPhase = "connecting_peer"
5. startMicrophone()                → callPhase = "starting_media"
6. startCamera(frontCameraId)       → verify cameraStream !== null
7. Render video                     → callPhase = "connected"
```

**Any deviation = architectural bug.**

### Guardrails

- `callPhase` state machine enforces order (Zustand store)
- Each phase transition is logged: `[VideoStore] Phase: X → Y`
- Each step checks the previous step's result before proceeding
- Failure at any step → `callPhase = "error"` with explicit message

---

## 4. Video Rendering Contract

### HARD RULE

**RTCView MUST NEVER RENDER WITHOUT a resolved video track.**

### Correct Pattern (VideoTile)

```tsx
const hasResolvedVideoTrack = (() => {
  if (!stream || isVideoOff) return false;
  try {
    const videoTracks = stream.getVideoTracks?.();
    return videoTracks && videoTracks.length > 0;
  } catch { return false; }
})();

{hasResolvedVideoTrack ? <RTCView ... /> : <AvatarFallback />}
```

### Anti-Patterns That Cause Black Screens

| Pattern                                          | Why It's Wrong                                 |
| ------------------------------------------------ | ---------------------------------------------- |
| `{stream && <RTCView />}`                        | Stream may exist with 0 video tracks           |
| `{!isVideoOff && <RTCView />}`                   | State may be stale; track may not be published |
| Rendering RTCView before `startCamera` resolves  | Track not yet available                        |
| Rendering RTCView during `connecting_peer` phase | Peer not connected                             |

### Safe Participant → Track Resolution

```tsx
// Remote participants from Fishjam SDK
stream={p.videoTrack?.stream}        // ✅ Track-level stream
isVideoOff={!p.isCameraOn}           // ✅ Derived from track existence
```

---

## 5. State Management (Anti-Regression)

### Rule

**ALL call state lives in Zustand (`useVideoRoomStore`). NO useState for call state.**

### Zustand Store Schema

```typescript
interface VideoRoomStoreState {
  // Room
  room: VideoRoom | null;
  roomId: string | null;
  localUser: LocalUser | null;
  participants: Participant[];
  connectionState: ConnectionState;

  // Call lifecycle
  callPhase: CallPhase; // strict state machine
  callType: CallType; // "audio" | "video"
  chatId: string | null;
  callEnded: boolean;
  callDuration: number;
  callStartedAt: number | null;

  // Permissions
  cameraPermission: PermissionState;
  micPermission: PermissionState;

  // Media
  isCameraOn: boolean;
  isMicOn: boolean;
  isFrontCamera: boolean;
  localStream: MediaStream | null;

  // Error
  error: string | null;
  errorCode: string | null;

  // Eject
  isEjected: boolean;
  ejectReason?: EjectPayload;
}
```

### Allowed vs Forbidden

| ✅ Allowed                                                 | ❌ Forbidden                                     |
| ---------------------------------------------------------- | ------------------------------------------------ |
| `useVideoRoomStore((s) => s.callPhase)`                    | `useState<CallPhase>()`                          |
| `getStore().setCallPhase("connected")`                     | `setState({ callPhase: "connected" })`           |
| `useState(false)` for local UI toggles (e.g. bottom sheet) | `useState` for room, participants, tracks, media |

### Why useState Causes Black Screens in RTC Apps

1. **Stale closures**: Callbacks capture old state, miss track updates
2. **Render cascades**: setState triggers re-renders that re-fire effects
3. **No cross-component sync**: Multiple components can't share call state
4. **No bail-out**: Every setState triggers re-render even if value unchanged

---

## 6. Signaling → UI Navigation

### Contract

```
Supabase Realtime INSERT on call_signals (callee_id = myId, status = "ringing")
  → IncomingCallOverlay shows full-screen accept/decline UI
  → Accept → router.push("/call/[roomId]?callType=X")
  → Call screen mounts inside FishjamProvider
  → useVideoCall.joinCall(roomId, callType)
```

### Failure Scenarios

| Scenario                               | Handling                                 |
| -------------------------------------- | ---------------------------------------- |
| Signal arrives but user is on call     | Ignore (or show "busy" in future)        |
| Signal arrives but app is backgrounded | Push notification (future)               |
| Accept but room no longer exists       | `video_join_room` returns 404 → error UI |
| Signal timeout (30s)                   | Auto-dismiss overlay                     |

---

## 7. Platform-Specific Guarantees

### iOS

- `infoPlist.NSCameraUsageDescription` REQUIRED in `app.config.js`
- `infoPlist.NSMicrophoneUsageDescription` REQUIRED in `app.config.js`
- Simulator: Camera not available — test on device only
- Dev Client rebuild required after adding `react-native-webrtc`

### Android

- `android.permission.CAMERA` in AndroidManifest
- `android.permission.RECORD_AUDIO` in AndroidManifest
- Foreground service may be needed for background calls (future)
- Dev Client rebuild required after adding `react-native-webrtc`

### Expo

- **Dev Client only** — Expo Go does NOT support WebRTC
- `react-native-webrtc` must be linked (auto-linked via Expo config plugins)
- After any native dependency change: `eas build` required
- OTA updates work for JS-only changes

---

## 8. Observability & Fail-Loud Policy

### Logging Contract

Every log line is prefixed with `[VideoCall]`, `[VideoStore]`, `[Permissions]`, or `[CallSignals]`.

| Event              | Log Level | Example                                                         |
| ------------------ | --------- | --------------------------------------------------------------- |
| Phase transition   | `log`     | `[VideoStore] Phase: idle → creating_room`                      |
| Room created       | `log`     | `[VideoCall] Room created: <uuid>`                              |
| Peer connected     | `log`     | `[VideoCall] Fishjam peer join initiated`                       |
| Camera started     | `log`     | `[VideoCall] Camera started, track: true, stream: true`         |
| Permission denied  | `error`   | `[Permissions] BLOCKED: Camera permission denied`               |
| Camera stream null | `error`   | `[VideoCall] CRITICAL: Camera started but cameraStream is null` |
| Room join failed   | `error`   | `[VideoCall] ERROR: Room join failed: <message>`                |
| Media start failed | `error`   | `[VideoCall] ERROR: FAILED to start camera: <error>`            |

### NO SILENT FAILURES

- Every `catch` block logs the error AND updates the store
- Every error sets `callPhase = "error"` which renders explicit error UI
- No `catch(() => {})` or `catch(console.warn)` without store update

---

## 9. Black-Screen Failure Matrix

| Symptom                                 | Root Cause                                  | Detection                                        | Fix                                          |
| --------------------------------------- | ------------------------------------------- | ------------------------------------------------ | -------------------------------------------- |
| **Black local preview**                 | Camera started before peer connected        | `callPhase` not `connected` when RTCView renders | Enforce join order: peer → media → render    |
| **Black local preview**                 | `cameraStream` is null after `startCamera`  | Log: `CRITICAL: cameraStream is null`            | Check permissions, retry, show error UI      |
| **Black local preview**                 | Wrong camera device (back instead of front) | No `front` in device label                       | Fallback to first available device           |
| **Black remote video**                  | Remote peer hasn't published video track    | `p.videoTrack` is undefined                      | Show avatar fallback, don't render RTCView   |
| **Black remote video**                  | Stream exists but 0 video tracks            | `getVideoTracks().length === 0`                  | `hasResolvedVideoTrack` guard in VideoTile   |
| **Audio works, video doesn't**          | Camera permission denied                    | `cameraPermission === "denied"`                  | Show permission denied UI with Settings link |
| **Audio works, video doesn't**          | Camera in use by another app                | `startCamera` throws                             | Log error, show error UI                     |
| **Call connects but UI doesn't change** | `callPhase` stuck in `connecting_peer`      | Phase never transitions to `starting_media`      | Timeout + error after 15s                    |
| **Works on Android, black on iOS**      | Missing `NSCameraUsageDescription`          | iOS blocks camera silently                       | Verify `infoPlist` in `app.config.js`        |
| **Works on Android, black on iOS**      | Simulator limitation                        | Camera not available in simulator                | Test on physical device                      |
| **Intermittent black screen**           | Race condition: render before track ready   | RTCView renders with stale stream                | `hasResolvedVideoTrack` guard                |
| **Black after camera switch**           | `_switchCamera` not available on track      | Log: `_switchCamera not available`               | Don't attempt switch, log warning            |

---

## 10. Enforcement Rules

### Pre-Merge Checklist

- [ ] No `useState` for call state (room, participants, tracks, media, permissions)
- [ ] RTCView guarded by `hasResolvedVideoTrack` check
- [ ] Every `catch` block logs AND updates store error state
- [ ] `callPhase` transitions are sequential and logged
- [ ] Permissions requested and awaited BEFORE room join
- [ ] Front camera selected by default (video mode only)
- [ ] Error UI rendered for `callPhase === "error"` and `"perms_denied"`
- [ ] No empty 200 responses from edge functions
- [ ] TypeScript passes with zero errors
- [ ] Audio calls NEVER request camera permission
- [ ] Audio calls NEVER enable camera
- [ ] Audio calls NEVER render RTCView
- [ ] Camera toggle in audio mode goes through `escalateToVideo()`
- [ ] `setCameraOn(true)` blocked by runtime assertion in audio mode

### Never-Regress Principles

1. **No optimistic RTCView rendering** — always check track existence
2. **No silent catch blocks** — every error must surface
3. **No useState for shared call state** — Zustand only
4. **No room join without permissions** — gated by state machine
5. **No camera start without peer connection** — join order enforced
6. **No edge function returns empty 200** — always `{ ok, data?, error? }`
7. **No camera in audio mode** — runtime assertion in Zustand store
8. **No shared "requestAllPermissions"** — permissions are mode-aware
9. **No implicit video assumptions** — `callType` checked before every camera operation

### Key Files

| File                                        | Purpose                                       |
| ------------------------------------------- | --------------------------------------------- |
| `src/video/stores/video-room-store.ts`      | Zustand store — ALL call state + audio guards |
| `lib/hooks/use-video-call.ts`               | Call lifecycle hook — mode-aware join order   |
| `src/video/hooks/useMediaPermissions.ts`    | Permission state machine (mode-aware)         |
| `app/(protected)/call/[roomId].tsx`         | Call screen — audio/video split rendering     |
| `components/call/incoming-call-overlay.tsx` | Signaling → navigation                        |
| `supabase/functions/video_create_room/`     | Room creation edge function                   |
| `supabase/functions/video_join_room/`       | Room join + token minting                     |

---

## AUDIO-FIRST ARCHITECTURE

> Audio calls are FIRST-CLASS citizens. Video is an optional upgrade.

---

## 11. CallMode as a First-Class Concept

### Type Definition

```typescript
export type CallType = "audio" | "video";
```

### Where CallType Lives

| Layer             | Location                        | How It's Set                              |
| ----------------- | ------------------------------- | ----------------------------------------- |
| **Edge Function** | `call_signals.call_type` column | Set by caller when sending signal         |
| **Client Store**  | `useVideoRoomStore.callType`    | Set BEFORE room join, never implicit      |
| **Hook**          | `useVideoCall.callType`         | Read from store, passed to `startMedia()` |
| **UI**            | `isAudioMode` derived boolean   | Drives which UI renders                   |

### Why Implicit Video Assumptions Break Audio Calls

| Assumption                                    | How It Breaks Audio                                            |
| --------------------------------------------- | -------------------------------------------------------------- |
| "Always request camera permission"            | Unnecessary prompt, user denies → call blocked                 |
| "Always start camera after join"              | Camera starts in audio mode → wasted resources, confusing UI   |
| `setCameraOn(true)` without mode check        | Store says camera is on, UI shows video controls in audio call |
| RTCView renders for all calls                 | Black rectangle in audio-only call                             |
| `stopCamera()` in `leaveCall` unconditionally | Noisy error logs for audio calls that never started camera     |

---

## 12. Permission Differentiation

### Permission Gating Matrix

| Call Mode      | Microphone      | Camera              | Behavior on Denial                      |
| -------------- | --------------- | ------------------- | --------------------------------------- |
| **Audio**      | REQUIRED        | NOT REQUESTED       | Block call, show "Mic required"         |
| **Video**      | REQUIRED        | REQUIRED            | Block call, show "Permissions required" |
| **Escalation** | Already granted | REQUESTED on demand | Show toast if denied, stay in audio     |

### Implementation

```typescript
// useMediaPermissions.requestPermissions(callType)
if (callType === "audio") {
  // Request mic ONLY — camera is NOT touched
  setCameraPermission(hasCamPerm ? "granted" : "pending"); // passive check
} else {
  // Request both mic AND camera
}
```

### Failure Cases When Camera Is Requested Unnecessarily

| Scenario                                      | Result                                                 |
| --------------------------------------------- | ------------------------------------------------------ |
| Audio call requests camera → user denies      | Call blocked even though camera isn't needed           |
| Audio call requests camera → iOS shows prompt | Confusing UX — "why does a phone call need my camera?" |
| Audio call starts camera → battery drain      | Unnecessary resource usage                             |

---

## 13. Mode-Aware Room Join Sequence

### AUDIO CALL ORDER

```text
1. requestPermissions("audio")     → mic ONLY
2. videoApi.createRoom()            → callPhase = "creating_room"
3. videoApi.joinRoom(roomId)        → callPhase = "joining_room"
4. fishjam.joinRoom({ peerToken })  → callPhase = "connecting_peer"
5. startMicrophone()                → callPhase = "starting_media"
6. [SKIP camera entirely]           → setCameraOn(false) explicitly
7. callPhase = "connected"          → Render AUDIO UI (avatars, no RTCView)
```

### VIDEO CALL ORDER

```text
1. requestPermissions("video")      → mic + camera
2. videoApi.createRoom()            → callPhase = "creating_room"
3. videoApi.joinRoom(roomId)        → callPhase = "joining_room"
4. fishjam.joinRoom({ peerToken })  → callPhase = "connecting_peer"
5. startMicrophone()                → callPhase = "starting_media"
6. startCamera(frontCameraId)       → verify cameraStream !== null
7. callPhase = "connected"          → Render VIDEO UI (RTCView grid)
```

### Guardrails Preventing Cross-Mode Leakage

| Guard                             | Location      | Behavior                                            |
| --------------------------------- | ------------- | --------------------------------------------------- |
| `setCameraOn(true)` in audio mode | Zustand store | Logs INVARIANT VIOLATION, returns without setting   |
| `toggleCamera()` in audio mode    | Zustand store | Logs INVARIANT VIOLATION, returns without toggling  |
| `startMedia("audio")`             | Hook          | Explicitly calls `setCameraOn(false)`, logs skip    |
| `leaveCall()`                     | Hook          | Only calls `stopCamera()` if `callType === "video"` |

---

## 14. Audio Rendering Contract

### HARD RULE: Audio calls do NOT use RTCView

Audio tracks auto-play via WebRTC — no view component needed.

### Correct Audio-Only Rendering Pattern

```tsx
{
  isAudioMode ? (
    // AUDIO: Avatars + speaking indicators + mute state
    <AudioCallUI participants={participants} />
  ) : (
    // VIDEO: RTCView grid with track guards
    <VideoGrid participants={participants} localStream={localStream} />
  );
}
```

### Anti-Patterns

| Pattern                                           | Why It's Wrong                                          |
| ------------------------------------------------- | ------------------------------------------------------- |
| `{!isVideoOff && <RTCView />}` in audio mode      | `isVideoOff` could be stale; RTCView should never mount |
| Hiding video with `opacity: 0`                    | RTCView still consumes resources                        |
| Single component for both modes with conditionals | Leaks video assumptions into audio path                 |

### How to Verify Audio Track Presence

```typescript
// In startMedia("audio"):
await micRef.current.startMicrophone();
s.setMicOn(true);
log("[AUDIO] Microphone started — audio track publishing");
// If this succeeds, audio is flowing. No further verification needed.
```

---

## 15. Audio-Safe State Management

### Zustand Runtime Assertions

```typescript
setCameraOn: (isCameraOn) => {
  if (isCameraOn && get().callType === "audio") {
    console.error("[VideoStore] INVARIANT VIOLATION: setCameraOn(true) in audio mode");
    return; // BLOCKED
  }
  set({ isCameraOn });
},
```

### State Rules by Mode

| State Field        | Audio Mode                  | Video Mode                |
| ------------------ | --------------------------- | ------------------------- |
| `callType`         | `"audio"`                   | `"video"`                 |
| `isCameraOn`       | ALWAYS `false`              | `true`/`false`            |
| `isMicOn`          | `true`/`false`              | `true`/`false`            |
| `localStream`      | `null`                      | `MediaStream` or `null`   |
| `cameraPermission` | `"pending"` (not requested) | `"granted"` or `"denied"` |

### How Improper State Causes "Dead Mic" Bugs

1. `toggleMic()` calls `stopMicrophone()` but store says `isMicOn: true` → UI shows unmuted but mic is off
2. `startMicrophone()` fails silently → `isMicOn` never set to `true` → UI shows muted forever
3. Camera error in video mode sets `callPhase: "error"` → mic also stops → audio dies with video

---

## 16. Audio-Only UI Contract

### Audio Call Screen Responsibilities

| Element                   | Present  | Notes                                       |
| ------------------------- | -------- | ------------------------------------------- |
| Participant avatars       | ✅       | With remote avatar from peer metadata       |
| Call duration             | ✅       | Same timer as video                         |
| Mute toggle               | ✅       | Mic on/off                                  |
| End call                  | ✅       | Same as video                               |
| "Upgrade to Video" button | ✅       | Explicit escalation via `escalateToVideo()` |
| RTCView                   | ❌ NEVER | Not even hidden — not mounted               |
| Camera toggle             | ❌ NEVER | Only appears after escalation to video      |
| Switch camera             | ❌ NEVER | Only appears after escalation to video      |

### Controls Bar by Mode

```text
AUDIO: [ Mic ] [ 📹 Upgrade ] [ Participants ] [ End ]
VIDEO: [ Mic ] [ Camera ] [ Switch ] [ Participants ] [ End ]
```

---

## 17. Audio ↔ Video Escalation

### Escalation Flow (audio → video)

```text
1. User taps "Upgrade to Video" button
2. escalateToVideo() called in hook
3. startCamera(frontCameraId) attempted
4. If camera permission denied → show toast, stay in audio
5. If camera starts successfully:
   a. store.escalateToVideo()  → callType: "audio" → "video"
   b. store.setCameraOn(true)  → now safe (callType is "video")
6. UI automatically switches to video grid (driven by isAudioMode selector)
```

### Failure Handling

| Failure                             | Behavior                                                         |
| ----------------------------------- | ---------------------------------------------------------------- |
| Camera permission never granted     | `startCamera` fails → toast "Camera Unavailable" → stay in audio |
| Camera permission previously denied | Same as above — user must go to Settings                         |
| Camera hardware error               | `startCamera` throws → toast → stay in audio                     |
| Stream is null after start          | Explicit check → error surfaced → stay in audio                  |

### Rules

- Escalation is **explicit** — user must tap a button
- Camera is **never** auto-enabled
- UI **must** confirm permission success before switching mode
- If escalation fails, call continues as audio — **no disruption**

---

## 18. Audio-Specific Observability

### Audio Log Contract

| Event                   | Log                                                     | Level   |
| ----------------------- | ------------------------------------------------------- | ------- |
| Audio call starting     | `[AUDIO] Skipping camera — audio-only mode`             | `log`   |
| Mic started             | `[AUDIO] Microphone started — audio track publishing`   | `log`   |
| Mic failed              | `[AUDIO] FAILED to start microphone: <error>`           | `error` |
| Mic muted               | `Mic muted`                                             | `log`   |
| Mic unmuted             | `Mic unmuted`                                           | `log`   |
| Mic unmute failed       | `Failed to unmute mic: <error>`                         | `error` |
| Camera blocked in audio | `INVARIANT VIOLATION: setCameraOn(true) in audio mode`  | `error` |
| Escalation started      | `[ESCALATION] Audio → Video: requesting camera...`      | `log`   |
| Escalation succeeded    | `[ESCALATION] Successfully upgraded to video call`      | `log`   |
| Escalation failed       | `[ESCALATION] Camera permission denied or start failed` | `error` |
| Audio call ended        | `[AUDIO] Call ended, duration: <n>`                     | `log`   |

### Debug Checklist for Audio Issues

1. Check `[AUDIO] Microphone started` appears in logs
2. Check `isMicOn` in Zustand store is `true` after connect
3. Check `callPhase` reaches `"connected"`
4. Check no `INVARIANT VIOLATION` errors in logs
5. Check remote peer has `audioTrack` in participants array
6. Check device audio route (speaker vs earpiece)

---

## 19. Audio Failure Matrix

| Symptom                               | Root Cause                                            | Detection                                                   | Fix                                                       |
| ------------------------------------- | ----------------------------------------------------- | ----------------------------------------------------------- | --------------------------------------------------------- |
| **No audio but call connects**        | `startMicrophone()` failed silently                   | Log: `FAILED to start microphone`                           | Check mic permission, surface error UI                    |
| **No audio but call connects**        | Mic permission denied                                 | `micPermission === "denied"` in store                       | Show permission denied UI                                 |
| **Mic toggle does nothing**           | `stopMicrophone`/`startMicrophone` not awaited        | Mic state and track.enabled out of sync                     | Await mic operations, verify `isMicOn` matches track      |
| **Audio works on one device only**    | Remote peer not subscribing to audio track            | No `audioTrack` on remote peer object                       | Check Fishjam peer subscription, verify token permissions |
| **Works in video, not in audio mode** | Audio mode skips some shared init step                | Compare `startMedia("audio")` vs `startMedia("video")` logs | Ensure mic start is identical in both paths               |
| **Bluetooth/speaker routing issues**  | WebRTC audio route not configured                     | Device audio output mismatch                                | Use `InCallManager` or native audio session config        |
| **Echo or feedback**                  | Both speaker and mic active without echo cancellation | User reports echo                                           | Verify WebRTC echo cancellation is enabled                |
| **Camera starts in audio call**       | `setCameraOn(true)` called without mode check         | Log: `INVARIANT VIOLATION`                                  | Runtime assertion blocks it; fix the caller               |
| **Audio call shows video UI**         | `isAudioMode` not checked in render                   | Visual inspection                                           | Ensure render branches on `isAudioMode`                   |
| **Escalation fails silently**         | `escalateToVideo` error not surfaced                  | No toast or error UI                                        | Check `escalateToVideo` returns false → show toast        |
