# CallKeep Integration — Architecture & Test Plan

## Architecture Overview

DVNT uses **CallKeep** (`react-native-callkeep`) as the centralized native call UI layer for all call types. CallKeep provides:

- **iOS**: CallKit integration (native incoming call screen, lock screen UI, call history)
- **Android**: ConnectionService integration (native call management, foreground service)

### The "CallKeep Only" Rule

> **ALL native call UI interactions MUST go through `src/services/callkeep/callkeep.ts`.**
>
> Direct imports of `react-native-callkeep` outside this wrapper are **FORBIDDEN**.

This ensures:
1. Single point of control for all CallKeep configuration
2. Consistent logging and error handling
3. Bidirectional mapping between `callSessionId` (Supabase) and `callUUID` (device-local)
4. Listeners registered exactly ONCE — no duplicate subscriptions

### Module Structure

```
src/services/callkeep/
├── callkeep.ts              # Core wrapper — setup, actions, events
├── useCallKeepCoordinator.ts # Root-level hook wiring CallKeep ↔ Supabase ↔ Fishjam
└── index.ts                 # Barrel export
```

### Call Flow

#### Outgoing Call
```
User taps "Call" in chat
  → useVideoCall.createCall()
    → videoApi.createRoom() (Supabase Edge Function)
    → videoApi.joinRoom() (get Fishjam token)
    → joinRoom() (Fishjam SDK)
    → startMedia() (mic + optional camera)
    → callkeep.startOutgoingCall() ← NEW: reports to OS
    → callkeep.reportOutgoingCallConnected() ← NEW
    → callSignalsApi.sendCallSignal() (notify callees via Supabase Realtime)
```

#### Incoming Call
```
Supabase Realtime INSERT on call_signals (callee_id = current user)
  → useCallKeepCoordinator receives signal
    → callkeep.showIncomingCall() ← displays native OS call screen
    → User answers on native UI
      → callkeep onAnswer event fires
        → Navigate to /(protected)/call/[roomId]
        → callSignalsApi.updateSignalStatus("accepted")
        → Fishjam join happens via useVideoCall.joinCall()
    → User declines on native UI
      → callkeep onEnd event fires
        → callSignalsApi.updateSignalStatus("declined")
        → No Fishjam join
```

#### End Call
```
User taps "End" (in-app or OS UI)
  → useVideoCall.leaveCall()
    → callSignalsApi.endCallSignals()
    → callkeep.endCall() ← ends OS call UI (idempotent)
    → Stop media, leave Fishjam room
  OR
  → CallKeep onEnd event (from OS)
    → useCallKeepCoordinator.onEnd()
      → useVideoRoomStore.setCallPhase("call_ended")
      → callSignalsApi.updateSignalStatus("ended")
```

### State Management

- **All call state** lives in `useVideoRoomStore` (Zustand)
- **CallKeep** is a side-effect layer — it reports to/from the OS but does NOT own state
- **MMKV** persists `callSessionId ↔ callUUID` mapping for app restart survival

### Transport Layer

- **Fishjam** handles all audio/video transport (WebRTC)
- **CallKeep** handles native call UI only — it does NOT carry media
- These are independent: CallKeep can end without Fishjam ending, and vice versa

---

## Lint Guard (No ESLint Config)

Since the project does not use ESLint, enforce the "CallKeep Only" rule via code review:

**Forbidden pattern:**
```typescript
// ❌ NEVER do this outside src/services/callkeep/
import RNCallKeep from 'react-native-callkeep';
import { CONSTANTS } from 'react-native-callkeep';
```

**Required pattern:**
```typescript
// ✅ Always import from the wrapper
import { setupCallKeep, showIncomingCall, endCall } from '@/src/services/callkeep';
```

To verify no violations exist, run:
```bash
grep -r "from ['\"]react-native-callkeep['\"]" --include="*.ts" --include="*.tsx" | grep -v "src/services/callkeep/"
```

---

## Platform Configuration

### iOS
- **Info.plist**: `UIBackgroundModes` includes `voip` and `audio`
- **Info.plist**: `NSMicrophoneUsageDescription` updated for calls
- **Info.plist**: `NSCameraUsageDescription` already present
- **app.config.js**: `UIBackgroundModes: ["audio", "voip"]`
- **Plugin**: `@config-plugins/react-native-callkeep` in plugins array

### Android
- **AndroidManifest.xml**: Added permissions:
  - `FOREGROUND_SERVICE`
  - `FOREGROUND_SERVICE_PHONE_CALL`
  - `MANAGE_OWN_CALLS`
  - `BIND_TELECOM_CONNECTION_SERVICE`
- **app.config.js**: Same permissions in `android.permissions` array
- **CallKeep setup**: `selfManaged: true` with foreground service config

### OS Limitations
- **iOS killed state**: VoIP push notifications required for reliable incoming calls when app is killed. Without a VoIP push certificate, CallKit will only work when app is in foreground/background.
- **Android killed state**: ConnectionService with `selfManaged: true` may not reliably show UI when app is killed. Firebase Cloud Messaging (FCM) high-priority push is recommended.
- **Simulator**: CallKit is not available on iOS Simulator. CallKeep setup will fail silently.

---

## Video Support

- `setupCallKeep()` configures `supportsVideo: true` on iOS
- Outgoing video calls set `hasVideo: true` in `startOutgoingCall()`
- Incoming video calls set `hasVideo: true` in `showIncomingCall()`
- Audio calls set `hasVideo: false` — camera permission is NOT requested
- Audio → Video escalation is explicit (user taps upgrade button)

---

## Test Plan Checklist

### 1:1 Calls
- [ ] Outgoing audio call — native call UI appears, mic works, no camera
- [ ] Outgoing video call — native call UI appears, mic + camera work
- [ ] Incoming audio call — native incoming call screen, answer → joins room
- [ ] Incoming video call — native incoming call screen with video indicator
- [ ] Decline incoming call — signal updated to "declined", no room join

### Group Calls
- [ ] Outgoing group audio call — all callees receive native incoming UI
- [ ] Outgoing group video call — all callees receive native incoming UI
- [ ] Incoming group call — native UI shows, answer joins correct room

### Lock Screen / Background
- [ ] Answer from lock screen (iOS) — app opens, call connects
- [ ] Answer from lock screen (Android) — app opens, call connects
- [ ] Decline from lock screen — signal updated, no navigation
- [ ] Missed call timeout (30s) — signal updated to "missed"

### End Call
- [ ] End from in-app UI — Fishjam leaves, OS call UI ends, signal updated
- [ ] End from OS call UI (Control Center / notification) — same cleanup
- [ ] End from remote side — local OS call UI ends automatically

### Media & Permissions
- [ ] Audio call does NOT request camera permission
- [ ] Video call requests both mic + camera
- [ ] Mute from in-app syncs to OS call UI
- [ ] Mute from OS call UI syncs to in-app
- [ ] Audio → Video escalation works mid-call

### Background / Lifecycle
- [ ] Background → return: call still active
- [ ] PiP for video calls (Fishjam native)
- [ ] Android foreground service running during active call
- [ ] App killed during call — call ends gracefully

### Edge Cases
- [ ] Double-tap answer — no crash, single join
- [ ] Rapid end/answer — no race conditions
- [ ] Network loss during call — reconnection or graceful end
- [ ] CallKeep setup failure (simulator) — app still works, falls back gracefully

---

## Deployment Note

CallKeep is a **native module** — it requires a full native build via EAS Build.
OTA updates alone will NOT include CallKeep. After merging:

```bash
eas build --platform ios --profile production
eas build --platform android --profile production
```

Then submit to TestFlight / Play Store. After the native build is live, OTA updates can be pushed normally.
