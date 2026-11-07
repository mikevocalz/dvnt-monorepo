# Sneaky Lynk full-room polish pass

Scope: continuation of draft PR #250 on its existing approved branch. No merge,
production deployment, credentials, payment behavior, or backend migration.

## Experience changes

- Web entry has bounded lookup/admission requests, safe retry, accurate full-room
  copy, and a reliable route back to Lynks. Late timed-out responses cannot start
  capture. Admission/transport error messages do not expose raw backend strings.
- A media connection failure keeps the admitted web room and its camera/mic,
  chat and leave controls visible. Connection labels follow actual media state.
- Prejoin explains exactly what anonymous mode hides, capture limitations, and
  the reviewed camera/microphone arrival state.
- Each web video can Fit or Fill its tile without recreating the player. Rotation
  targets are 44px. Pin/unpin, guest pagination and keyboard focus are explicit;
  all pages retain their audio subscriptions. Remote mic status is not guessed
  from publisher discovery.
- Web chat retains unsent text while its panel is closed, shows local send
  failures, handles repeated submissions, and preserves reading position.
  Participant search and avatars respect anonymous identities. Moderation labels
  describe co-host authority rather than disguising it as a speaking invitation.
- Panels isolate background interaction and restore keyboard focus. Participant
  actions and empty/error states have consistent hierarchy and target sizes.
- Native prejoin starts camera-off and muted, opens camera preview only after
  explicit permission, and applies reviewed media choices on entry. Off devices
  do not trigger unconditional entry permission prompts.
- Native connection trouble no longer replaces the room with a trapping spinner.
  Connection guidance, local controls, leaving progress, and initial-join retry
  remain available. Controls are labeled; participant and queue sheets are clearer.
- Native full-room entry is an explicit, single-flight retry through the actual
  admission path. The old “Notify me” path performed named admission probes;
  that misleading polling flow is no longer used. No waitlist, reservation, or
  background notification is claimed.

## Verification boundaries

The user requested implementation now and acceptance testing later. Targeted
production-component checks cover prejoin cancellation and device choices,
chat/panel privacy and focus, stage player ownership, connection failure/retry,
and phone/landscape/desktop layouts. Native UI checks use synthetic boundaries
or React Native Web; they are not an iOS/Android device pass. CI performs its
normal source/type/build/regression checks for the published commit.

Physical camera/microphone selection, Bluetooth/audio routing, Safari permission
and recovery behavior, native app/device rendering, and authenticated multi-device
continuity remain acceptance gates. Speaker routing stays in system settings.
No measured comparison supports a claim that DVNT exceeds Batemates, Sniffies,
Zoom, Teams or Meet. Batemates/Sniffies inform social-room behavior; meeting apps
inform clarity and reliability, not an enterprise-meeting redesign.
