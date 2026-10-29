# Sneaky Lynk co-host moderation verification

## Fixed

ParticipantsPanel previously received a host-only boolean, hiding all moderation
from a co-host. It now derives the actor role from the active server roster, so
promotion, demotion, removal, and panel reopening reflect current permissions.

The UI mirrors the existing server authorization, without changing any backend
policy or room-plan limits:

- Host/co-host/moderator: individual mute, release-mute, and removal controls.
- Self and room host: no target moderation controls.
- Moderator targeting another moderator: no removal control, matching the edge.
- Role promotion/demotion and bulk mute remain host-only.
- Release-mute does not force somebody's microphone on.

## Evidence

Production RoomInner and ParticipantsPanel are bundled with real React/Tailwind
and exercised in Chromium. Only account, backend, media, and device boundaries
are fixtures. Each scenario contains 12 members and tests accessible controls,
actual API callback wiring, server-denial feedback, promotion/demotion while the
panel is open, inactive actors, and close/reopen.

- Baseline `f15eeb12484a61adb307b4155f7e08471ac360c8` fails the co-host test
  because the individual moderation controls are absent.
- Fixed moderation matrix: 40 passing combinations (four roles × ten phone,
  landscape, tablet, and desktop viewports).
- Session regressions: 83 passed.
- Parent independent source review checked backend permission parity.

Run `node scripts/test-lynk-layout-browser.cjs`. Select the focused suite with
`LYNK_LAYOUT_SUITES=moderation`; optional `LYNK_LAYOUT_CASES` and
`LYNK_MODERATION_ROLES` narrow diagnosis. The existing responsive layout workflow
runs the full suite and uploads screenshots.

These checks do not prove a live 12-person call. Physical-device authenticated
multi-user audio/video/chat, provider behavior, and network reconnect acceptance
remain separate. No deployment, migration, credential, or entitlement change is
part of this patch.

## Additional related polish

The local stage tile now derives its co-host badge from the current role rather
than an admission-time ref. The rendered moderation test checks both promotion
and demotion update that badge.

Chat no longer scrolls readers to the bottom whenever another guest posts. It
follows new messages only while pinned to the latest; otherwise an accessible
“Jump to latest messages” button appears. Sending/reopening returns to latest.
`node scripts/test-lynk-chat-scroll.cjs` mounts the production ChatPanel with
DOM-only scroll geometry adapters. The baseline reproduced a jump from 100 to
1400; the corrected test covers pinned follow, preserved history, jump, manual
clear, and reopening. This test is included in the responsive layout CI job.
