# Remaining Lynk controls and full-room entry

Continuation of draft PR #250 on its existing branch. No merge, production
release, deployment setting changes, credentials or live data migration.

## Changes

- Speaker selection routes the AudioContext used by each actual MoQ decoder.
  It never uses a dummy HTML media element or rebuilds the video player.
- The browser speaker chooser opens only from an explicit click. The chosen
  route is session-only; microphone/camera consent and anonymous identity are
  unchanged. Unsupported browsers retain system-settings guidance.
- Replaced/disconnected output devices produce visible status. Sink writes are
  serialized across rapid changes and router resets, and playback stays gated
  until the latest supported route applies. Routing failure cannot silently
  report that headphones are selected.
- Full-room users can opt in to foreground-only retries. Attempts start at five
  seconds and back off to 10, 20, then 30 seconds. Manual attempts share the same
  lock and visible cooldown. This is not a seat queue, reservation or notification.
- Stop, background/blur and account changes invalidate pending admission intent.
  Late successful admission never turns on capture. Same-process admissions and
  their cleanup are serialized per account/room across screen lifetimes, so an
  old leave cannot remove a newly joined session in that process.
- API dispatch checks ownership after asynchronous auth-token lookup. Batched
  account changes cannot revive an older request. The obsolete named-capacity
  polling hook is removed.
- Fixed the old room-browser fixture's missing icon exports and message-copy
  contract; retained its two-client, account-isolation and failed-draft checks.

## Checks and boundaries

The room regression workflow commands pass locally, including actual production
components, controlled API/token boundaries, shared retry timers, native guarded
admission, real pinned MoQ signals and transport authorization fixtures. Full
source Node tests and focused type/lint checks also pass. Browser checks cover
entry failures, late responses, opt-in/cancellation, rapid visibility/account
changes, and phone/landscape/desktop settings and controls.

These are synthetic automated checks, not physical or live multi-user acceptance.
Physical iOS/Android, Safari, Bluetooth/output audibility and authenticated
multi-device continuity remain deferred. A hung request intentionally retains
its local admission lock until it settles; the user can always leave the screen.
Serialization is process-local, not a cross-device session protocol. Native
speaker routing remains controlled by the operating system.
