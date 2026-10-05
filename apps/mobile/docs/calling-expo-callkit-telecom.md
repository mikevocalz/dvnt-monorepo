# DVNT — expo-callkit-telecom / Fishjam migration spike

This branch tests `expo-callkit-telecom` PR #44 against DVNT's existing
`@fishjam-cloud/react-native-webrtc@0.29.0` stack.

## Why

The upstream module previously pulled LiveKit's WebRTC pod unconditionally.
PR #44 removes that pod dependency and compiles against a small private header
surface so the consuming app supplies its own WebRTC implementation.

DVNT ships Fishjam's WebRTC framework, so it must not pull a second WebRTC
framework defining the same `RTC*` Objective-C classes.

## DVNT changes

- Pin `expo-callkit-telecom` to upstream PR #44.
- Keep the existing `callkeep` wrapper API so the Fishjam call layer does not
  need a broad rewrite.
- Route the iOS wrapper calls through `expo-callkit-telecom`.
- Let `expo-callkit-telecom` own iOS WebRTC audio-session activation and
  restoration for the migrated path.
- Keep Android on the existing CallKeep implementation for this spike.
- Keep DVNT's existing PushKit implementation unchanged until the physical
  device test confirms the migration path.

## Required validation

Build a clean iOS development client on a physical iPhone.

1. Confirm Pods contain Fishjam's WebRTC framework and do not install
   `WebRTC-SDK` or `livekit-react-native-webrtc`.
2. Launch DVNT and confirm no duplicate `RTC*` Objective-C class warnings.
3. Place an outgoing audio call.
4. Place an outgoing video call.
5. Confirm CallKit audio activation reaches the Fishjam media session.
6. Confirm two-way microphone/audio.
7. Toggle speaker and connect/disconnect Bluetooth or wired audio.
8. Confirm native mute reaches the Fishjam microphone state.
9. End locally and remotely; confirm audio-session restoration.
10. Repeat after locking the phone.
11. Test incoming VoIP push while DVNT is backgrounded/killed.

## Important

The upstream PR currently documents physical CallKit audio activation and
Fishjam builds as not yet tested upstream. This DVNT PR is therefore a
migration/validation PR until those device tests pass.

Upstream PR: https://github.com/mfairley/expo-callkit-telecom/pull/44
