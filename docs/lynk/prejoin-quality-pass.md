# Sneaky Lynk pre-join quality pass

## Scope

Source-only first increment against master 50154da. No deployment, Vercel build,
merge, live room, credentials, production data, or native release.

The live public site loaded at dvntapp.live, but the available browser was signed
out. Authenticated room behavior and multi-device continuity were not tested.
Batemate and Sniffies are the primary feature/experience competitors. Zoom,
Teams and Meet are reliability/polish references only. This increment does not
establish parity or superiority against any of them.

## Confirmed source gaps repaired

- The old pre-join component requested video for every room, including audio-only
  rooms. It now receives the authoritative room mode and never opens the camera
  for audio-only entry. Room mode from the server wins over URL hints.
- Camera startup rendered the same "Camera off" message as an intentional mute.
  Startup, ready, off and unavailable states are now distinct. Permission denial,
  absent device and device-in-use errors have actionable guidance and a retry.
- Join stopped only an already-resolved stream. An in-flight request could later
  create a preview while a denied/deferred verification gate kept entry mounted.
  Requests now have explicit lifetime ownership; all obsolete results stop.
  Stopping happens only after verification permits this current entry.
- Join never upgrades a failed/pending preview into an unexpected live camera.
  The reviewed choice can only be downgraded if capture stops or the user later
  turns it off. Duplicate and stale verification callbacks cannot commit entry.
- The anonymity switch lacked an accessible name. It now has one and a 44px
  target. Camera and microphone controls have visible labels and focus treatment.

## Layout direction

Preserve DVNT's dark room background, red primary Join, cyan accent, existing
room safety language, anonymity choice, microphone preference and verified gate.
The preview/device controls and entry choices use a side-by-side desktop layout,
stacking on smaller widths. No new dependency or design system is introduced.

Inspected references (structure only, not branding):

- [Zoom pre-join](https://mobbin.com/screens/273da49d-9c89-41e8-8787-c6361ee62d6b):
  preview and device controls beside identity/Join.
- [Descript pre-join](https://mobbin.com/screens/47f67e02-a540-468c-b69f-927693d2296c):
  device setup beside join choices.

The error language, conservative camera-off fallback and anonymity placement
are DVNT-specific engineering decisions. Microphone testing is explicitly not
claimed: this preview acquires video only.

## Validation

- Production pre-join component + actual store/hook/admission commit function in
  React/JSDOM: audio-only mode, pending Join/unmount cancellation, StrictMode,
  blocked/deferred verification, duplicate/stale admission, off/on reverse-order
  resolution, capture mute/unmute/ended, explicit retry, no-device API, microphone
  preference, named anonymity switch. Media and verification are synthetic.
- Existing 130 room entry/session/layout unit regressions pass.
- Existing web capture UI and multi-client chat/roster React regressions pass.
- Focused strict TypeScript for new component/hook/helper passes.
- verify-lynk and whitespace checks pass.
- Independent source review found no blocking issue; recommended race cases were
  subsequently added.
- Synthetic visual fixture bundles with real Tailwind utilities. Browser rendering
  is NOT verified: CUA's browser could not reach the executor's localhost:4178
  (ERR_CONNECTION_REFUSED). No before/after screenshot is claimed.
- Full workspace typecheck, aggregate lint/build, CI and physical-device tests
  remain release gates; this checkout has isolated fixture dependencies only.

Run the targeted regression with the isolated fixture dependencies used in
.github/workflows/lynk-room-regressions.yml:

    node scripts/test-lynk-prejoin-dom.cjs

A local synthetic preview (no live calls or camera access) is available with:

    node scripts/preview-lynk-prejoin.cjs

## Release and next verification gates

The user approved the possible automatic Vercel preview build for this branch.
Source publication and draft CI are permitted; production deployment, merging,
project setting changes and live-room testing remain outside this increment.

Before describing the room as polished or production-ready:

1. Render this change at narrow phone, phone landscape and desktop sizes with
   long titles; verify no overflow, reachable Join, keyboard focus and screen reader.
2. Exercise actual Chrome/Safari camera denial, retry, camera unplug, permission
   prompts, Back, account change, anonymous entry and audio-only room entry.
3. Test real two-device audio/video with host/participant roles, reconnects,
   token renewal, background/foreground, device changes, host mute and leave/end.
   The previously deployed token renewal patch is not continuity proof.
4. Evaluate and specify device selection, microphone metering and output checks;
   those capabilities were not implemented in this increment.
5. Audit in-room layout with actual participants and media, rather than inferring
   perceived quality from a synthetic pre-join page.

## Primary social-room competitor findings

Public documentation inspected on November 7, 2026; these are product claims,
not hands-on performance or security measurements.

- [Batemates features](https://batemates.app/features) describe feed-created rooms,
  titles/tags, a participant cap up to 32, Auto-host admission, adaptive grids,
  pinning, locally hiding a participant with their audio, in-room messaging and
  minimizing the room while browsing. It is the direct group-room comparator.
- Its [changelog](https://batemates.app/whatsnew) documents camera, microphone and
  speaker selection before and during rooms, speaker indicators and layout
  switching. These are concrete next capability checks, not assumed DVNT parity.
- Its [moderation guide](https://batemates.app/the-bator-hub/managing-participants-in-batemates-rooms)
  separates local hide from host kick and mute. Preserve that distinction when
  evaluating DVNT moderation rather than making every preference a host action.
- [Sniffies terms](https://sniffies.com/policies/terms-of-service) describe LivePlay
  as one-to-one. Its [safety guidance](https://sniffies.com/pages/resources/safety)
  documents anonymous web browsing, location precision and Discreet Mode. It is
  a reference for immediate discovery/discretion, not evidence for group video.

Next priorities: preserve mute/camera/anonymity through reconnects; clarify what
anonymity does and does not hide; verify active-room occupancy and invite/ended/
full states; distinguish personal hide from host authority; then device selectors
and microphone feedback. Keep entry social and immediate, not meeting-oriented.
Actual competitor latency, retry behavior, capture guarantees and encryption
were not verified and are not claimed here.
