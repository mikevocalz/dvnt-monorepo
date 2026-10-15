# DVNT live-room screen share + host pin — S06

Current draft adds testable role/capability and stale-event rules. **It does not expose a nonfunctional screen-share button or claim MoQ publishes display capture yet.** User-facing UI is gated until the complete transport is staged.

## Host pinning and local pins
- Existing `stores/pin-store.ts` is *private per-viewer*. Never reuse that store as room-wide host spotlight.
- Add host-authoritative room spotlight on server: active host/co-host may set/clear one member handle; SQL/Edge checks room status, current membership, ban and role. Send `{roomId, participantHandle, revision}` to admitted roster only. The client reducer drops stale room/revision events; `member:<id>` remains opaque.
- Spotlight is visually distinct from a viewer's local pin and accessible via named control. Host-end/leave clears the spotlight and reconnect fetches an authoritative snapshot. No automatic speaker pin without user permission.

## Web screen sharing
- Detect secure-context `navigator.mediaDevices.getDisplayMedia` and explicit gesture; acquire a display track then publish via an audited MoQ source-switch adapter. Do not treat `navigator.share` (sharing a URL) as screen sharing.
- Mute share audio by default; include source preview, stop/share indicator and browser stop-event handler. Refuse private/app-only rooms if capture policy disallows; no silent capture, no auto-restart after reconnect.
- Preserve camera stream across share start/stop and make screen tiles 16:9 `object-contain` with accessible speaker/owner badges.
- Mobile: use supported native screen-broadcast capability only after Expo build, screen-recording consent and platform-specific QA. Do not synthesize a fake native share toggle.
- Security: no capture telemetry PII or raw credentials; host revocation and session end must immediately remove share. Browser screenshot protection remains deterrence; permission to screen share is a distinct user consent.

## Acceptance
Solo/duo/6-person, remote join/leave, host/cohost permission, anonymous participant privacy, stale events, multi-device display capture, audio/video return to camera, browser stop, background/foreground and denied capture. Review [Zoom room controls](https://mobbin.com/screens/4c927607-e330-478b-885d-0c8213a9cc19) for affordance patterns but retain DVNT's tokens and semantic controls.

Roles: Distinguished RTC engineer, Staff Supabase AppSec, Principal UI/UX, Expo native screen capture reviewer and QA. Skills: Expo/skills, agent-device, Impeccable, React best practices, Supabase and no-ai-slop. **No deployment/merge.**
