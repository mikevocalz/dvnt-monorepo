# Call Audio Architecture — Deviant

## Overview

Audio/video calls use **Fishjam SDK** (WebRTC) for media transport, **CallKeep** (CallKit on iOS, ConnectionService on Android) for native call UI/lifecycle, and **Supabase** for call signaling/session state.

## Fishjam Documentation References (MANDATORY)

These docs MUST be consulted before modifying any call/media code:

| Topic | URL |
|-------|-----|
| Connecting | https://docs.fishjam.io/how-to/react-native/connecting |
| Start Streaming | https://docs.fishjam.io/how-to/react-native/start-streaming |
| List Other Peers | https://docs.fishjam.io/how-to/react-native/list-other-peers |
| Screen Sharing | https://docs.fishjam.io/how-to/react-native/screensharing |
| Background Streaming | https://docs.fishjam.io/how-to/react-native/background-streaming |
| Picture-in-Picture | https://docs.fishjam.io/how-to/react-native/picture-in-picture |
| Metadata | https://docs.fishjam.io/how-to/react-native/metadata |
| Reconnection | https://docs.fishjam.io/how-to/react-native/reconnection-handling |
| Room Types | https://docs.fishjam.io/explanation/room-types |
| Vision Camera Sources | https://docs.fishjam.io/how-to/react-native/custom-video-sources/vision-camera |

## Audio Session Lifecycle (CRITICAL)

### iOS (CallKit)

```
1. audioSession.start(speakerOn)
   → InCallManager.start({ media: 'audio', auto: true })
   → Configures AVAudioSession category/mode
   → Does NOT call RTCAudioSession.audioSessionDidActivate()
   → Stores pending speaker state

2. CallKit fires didActivateAudioSession
   → useCallKeepCoordinator → audioSession.activateFromCallKit()
   → RTCAudioSession.audioSessionDidActivate()
   → Applies deferred speaker routing
   → Audio is NOW flowing

3. Fishjam startMicrophone()
   → Creates + publishes local audio track
   → Track uses the now-active audio session

4. audioSession.stop()
   → InCallManager.stop()
   → RTCAudioSession.audioSessionDidDeactivate()
```

**INVARIANT**: On iOS, `RTCAudioSession.audioSessionDidActivate()` MUST only be called from `audioSession.activateFromCallKit()`, which is triggered by the CallKeep `didActivateAudioSession` event. Calling it eagerly creates a race condition where the mic track is created on a dead/inactive audio session.

### Android

```
1. audioSession.start(speakerOn)
   → InCallManager.start({ media: 'audio', auto: true })
   → MODE_IN_COMMUNICATION + audio focus acquired
   → Speaker + mic applied immediately (no CallKit)

2. Fishjam startMicrophone()
   → Creates + publishes local audio track

3. audioSession.stop()
   → InCallManager.stop()
```

## Mute Implementation

Mute uses **two layers** that must stay in sync:

1. **Track-level**: `MediaStreamTrack.enabled = false` — keeps the track published but silences it. Remote side sees the track but receives silence.
2. **Hardware-level**: `InCallManager.setMicrophoneMute(true)` — OS-level mute as a fallback.

**INVARIANT**: Never use `stopMicrophone()` for mute. It UNPUBLISHES the track entirely — the remote side loses it and may never get it back.

## Speaker Routing

- `InCallManager.setForceSpeakerphoneOn(true/false)` — routes audio to speaker or earpiece.
- On iOS, speaker routing only works AFTER CallKit has activated the audio session.
- `audioSession.setSpeakerOn()` handles the deferral automatically.

## Call Controls Overlay

**INVARIANT**: The End/Leave button is ALWAYS visible during a call.

- Full controls bar auto-hides after 5s in video mode only.
- When hidden, a persistent red "End" pill remains visible (bottom-right).
- Tapping anywhere on the video brings the full controls back.
- Audio mode controls NEVER auto-hide.

## File Map

| File | Responsibility |
|------|---------------|
| `src/services/calls/audioSession.ts` | Audio session + routing (SINGLE source of truth) |
| `src/services/calls/callTrace.ts` | MMKV-backed call lifecycle tracing |
| `src/services/callkeep/callkeep.ts` | CallKeep wrapper (CallKit/ConnectionService) |
| `src/services/callkeep/useCallKeepCoordinator.ts` | Root-level CallKeep + signal subscription |
| `lib/hooks/use-video-call.ts` | Main call hook (create/join/leave/mute/video) |
| `src/video/hooks/useVideoRoom.ts` | Video room hook (SneakyLynk rooms) |
| `src/video/stores/video-room-store.ts` | Zustand store for ALL call state |
| `src/video/hooks/useMediaPermissions.ts` | Permission state machine |
| `src/features/calls/ui/CallScreen.tsx` | Call screen orchestrator |
| `src/features/calls/ui/controls/CallControls.tsx` | Controls overlay with persistent End button |
| `src/features/calls/ui/DevHud.tsx` | DEV-only audio/video diagnostics overlay |
| `src/features/calls/ui/deriveCallUiMode.ts` | UI mode derivation (single source of truth) |

## Runtime Invariants

1. **No other file may call InCallManager directly** — only `audioSession.ts`.
2. **No other file may call RTCAudioSession directly** — only `audioSession.ts`.
3. **setCameraOn(true) in audio mode = INVARIANT VIOLATION** — blocked by store.
4. **stopMicrophone() for mute = FORBIDDEN** — use track.enabled toggle.
5. **End button must ALWAYS be visible** — persistent pill when controls hide.
6. **All call state in Zustand** — no useState for room/participants/tracks/status.
7. **Fishjam SDK refs are ref-wrapped** — identity not guaranteed stable across reconnects.
