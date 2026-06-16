# Calls Architecture — Deviant

> **Owner**: This document is the source of truth for the 1:1 call system.
> Update it when changing any call-related code.

## Module Responsibilities

| Module                      | Path                                              | Responsibility                                                                                                                                                        |
| --------------------------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **audioSession**            | `src/services/calls/audioSession.ts`              | ONLY module that starts/stops in-call audio, sets speaker, sets mic mute (hardware). Uses `react-native-incall-manager` + `RTCAudioSession`.                          |
| **callTrace (CT)**          | `src/services/calls/callTrace.ts`                 | MMKV ring-buffer logger. `CT.trace`, `CT.warn`, `CT.error`, `CT.guard` for crash hardening.                                                                           |
| **callkeep**                | `src/services/callkeep/callkeep.ts`               | ONLY module touching `react-native-callkeep`. Setup, start/end calls, mute, audio route for CallKit/Android Telecom.                                                  |
| **useCallKeepCoordinator**  | `src/services/callkeep/useCallKeepCoordinator.ts` | Hook that registers CallKeep listeners and subscribes to Supabase `call_signals` for incoming calls. Mounted once in `(protected)/_layout.tsx`.                       |
| **useVideoCall**            | `lib/hooks/use-video-call.ts`                     | Core hook: `createCall`, `joinCall`, `leaveCall`, `toggleMute`, `toggleVideo`, `escalateToVideo`, `switchCamera`. Orchestrates Fishjam SDK + audioSession + CallKeep. |
| **video-room-store**        | `src/video/stores/video-room-store.ts`            | Zustand store — single source of truth for all call state. No `useState` for call data anywhere.                                                                      |
| **call screen (route)**     | `app/(protected)/call/[roomId].tsx`               | Thin wrapper: reads nav params, runs init (perms → create/join), delegates to `CallScreen`.                                                                           |
| **CallScreen orchestrator** | `src/features/calls/ui/CallScreen.tsx`            | Renders exactly ONE stage at a time based on `deriveCallUiMode()`. Never mutates call state directly.                                                                 |
| **deriveCallUiMode**        | `src/features/calls/ui/deriveCallUiMode.ts`       | Pure function: `(role, phase, callType, remoteJoined) → CallUiMode`. SINGLE source of UI state.                                                                       |
| **Stage components**        | `src/features/calls/ui/stages/`                   | `CallerRingingStage`, `ReceiverConnectingStage`, `InCallVideoStage`, `InCallAudioStage`, `TerminalStages`.                                                            |
| **CallControls**            | `src/features/calls/ui/controls/CallControls.tsx` | Mode-aware floating bottom bar. Auto-hides in video mode. Role-correct button sets.                                                                                   |
| **LocalPreviewBubble**      | `src/features/calls/ui/LocalPreviewBubble.tsx`    | Draggable local camera PiP bubble with edge-snapping.                                                                                                                 |
| **DevHud**                  | `src/features/calls/ui/DevHud.tsx`                | DEV-only debug overlay showing role, phase, audio state, track info.                                                                                                  |

## State Machine

```text
idle
  → requesting_perms → perms_denied (terminal)
  → creating_room → joining_room → connecting_peer → starting_media
    → outgoing_ringing (caller waits for callee)
      → connected (when first remote peer joins Fishjam)
    → connected (callee path — immediate after media starts)
  → reconnecting → connected | error
  → call_ended (terminal — auto-dismiss after 1.5s)
  → error (terminal)
```

### Gating Rules

1. **Caller** transitions `outgoing_ringing → connected` ONLY when `peers.remotePeers.length > 0` (peer sync effect).
2. **Callee** transitions to `connected` immediately after `startMedia()` succeeds.
3. Duration timer starts ONLY on `connected` transition, never before.
4. `call_ended` is set by `leaveCall()` or by external end (CallKeep coordinator).

## Role Derivation

- **Caller**: `createCall()` sets `callRole = "caller"`, `callDirection = "outgoing"`.
- **Callee**: `joinCall()` sets `callRole = "callee"`, `callDirection = "incoming"`.
- UI mode is derived by `deriveCallUiMode({ role, phase })` — NEVER stored separately.

## Audio Routing (audioSession.ts ONLY)

```text
createCall / joinCall
  → audioSession.start(speakerOn)     // iOS: playAndRecord + allowBluetooth
                                       // Android: IN_COMMUNICATION + audio focus
  → [300ms delay on iOS]
  → startMedia()                       // mic track created on active session

leaveCall
  → audioSession.stop()                // releases audio focus, deactivates session

toggleMute
  → MediaStreamTrack.enabled = !muted  // Fishjam track-level (keeps published)
  → audioSession.setMicMuted(muted)    // hardware-level sync
  → callKeepSetMuted(roomId, muted)    // CallKit mute indicator

speaker toggle (UI)
  → audioSession.setSpeakerOn(on)      // InCallManager.setForceSpeakerphoneOn
  → store.setSpeakerOn(on)             // Zustand for UI
```

### FORBIDDEN

- ❌ Calling `enableSpeakerphone()` / `disableSpeakerphone()` from `audio-route.ts` — legacy, bypasses audioSession.
- ❌ Calling `RTCAudioSession.audioSessionDidActivate()` directly — audioSession.start() handles it.
- ❌ Using `stopMicrophone()` / `startMicrophone()` for mute — unpublishes the track.
- ❌ Any file other than `audioSession.ts` importing `react-native-incall-manager`.

## Event Flows

### Outgoing Call (Caller)

1. `createCall(participantIds, isGroup, callType, chatId)`
2. Edge function: `video_create_room` → roomId
3. Edge function: `video_join_room` → Fishjam token
4. `joinRoom({ peerToken, peerMetadata })` — Fishjam peer connected
5. CallKeep: `startOutgoingCall()` — native call UI
6. Supabase: `sendCallSignal()` — notify callee(s)
7. `audioSession.start(speakerOn)` — activate audio
8. `startMedia(callType)` — mic (+ camera for video)
9. Phase → `outgoing_ringing`
10. Peer sync effect detects remote peer → phase → `connected`

### Incoming Call (Callee)

1. `useCallKeepCoordinator` receives Supabase realtime signal
2. CallKeep: `showIncomingCall()` — native incoming UI
3. User answers → CallKeep `onAnswer` → navigate to call screen
4. `joinCall(roomId, callType)`
5. Edge function: `video_join_room` → Fishjam token
6. `joinRoom({ peerToken, peerMetadata })` — Fishjam peer connected
7. `audioSession.start(speakerOn)` — activate audio
8. `startMedia(callType)` — mic (+ camera for video)
9. Phase → `connected` immediately

## Role-Based UI Modes

`deriveCallUiMode({ role, phase })` is the SINGLE source of UI state. It returns one of:

| Mode                  | Who    | When                                   | Controls Available                    |
| --------------------- | ------ | -------------------------------------- | ------------------------------------- |
| `CALLER_DIALING`      | Caller | Creating room → connecting peer        | Cancel, Flip Camera (video only)      |
| `CALLER_RINGING`      | Caller | `outgoing_ringing` phase               | Cancel, Flip Camera (video only)      |
| `RECEIVER_CONNECTING` | Callee | Answered via CallKeep, joining Fishjam | Cancel only                           |
| `IN_CALL_VIDEO`       | Both   | `connected` + callType=video           | Full: Mute, Speaker, Video, Flip, End |
| `IN_CALL_AUDIO`       | Both   | `connected` + callType=audio           | Mute, Speaker, Escalate-to-Video, End |
| `ENDED`               | Both   | Call terminated                        | Back to Chat                          |
| `ERROR`               | Both   | Error occurred                         | Go Back                               |
| `PERMS_DENIED`        | Both   | Permissions denied                     | Open Settings, Go Back                |

### Navigation Gating

- **Incoming call**: Callee sees ONLY CallKeep native UI until they accept. The app does NOT navigate to the call screen until `onAnswer` fires.
- **Outgoing call**: Caller navigates to call screen immediately but sees `caller_dialing` / `caller_ringing` UI — NOT the in-call UI.
- **Connected**: Both see `in_call` UI with full controls only after `connected` phase.

### Runtime Invariants

- Callee MUST NEVER be in `caller_dialing` or `caller_ringing` mode.
- Caller MUST NEVER be in `callee_connecting` mode.
- `in_call` mode requires `callPhase === "connected"`.
- DEV mode logs `INVARIANT VIOLATION` if these are violated.

## Debugging Checklist

- [ ] DEV HUD shows `audio=ON` when in call
- [ ] DEV HUD shows `rAud=Y` when remote peer has mic on
- [ ] DEV HUD shows `hwMute=N` when not muted
- [ ] `CT.trace` breadcrumbs in MMKV (key: `call_trace_events`)
- [ ] CallKeep UUID matches roomId (check MMKV `callkeep_mappings`)
- [ ] Fishjam peer metadata includes `userId`, `username`, `avatar`

## Regression Checklist (Before Merging)

1. **Outgoing audio call**: Caller hears callee, callee hears caller.
2. **Outgoing video call**: Both see and hear each other.
3. **Incoming call**: CallKeep shows native UI, answering connects.
4. **Mute toggle**: Muting silences local mic, remote side confirms silence. Unmuting restores.
5. **Speaker toggle**: Switching routes audio correctly.
6. **Call end**: Both sides see "Call Ended", auto-dismiss works.
7. **Decline/miss**: Caller sees timeout, callee's native UI dismisses.
8. **Role UI**: Caller sees "Ringing...", callee sees "Connecting..." — never both as caller.
9. **Audio → Video escalation**: Camera enables, remote sees video.
10. **PiP**: Video call → background → PiP activates. Foreground → PiP exits.
