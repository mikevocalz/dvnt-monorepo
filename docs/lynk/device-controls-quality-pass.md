# Sneaky Lynk device controls and media confidence

Continuation of the prejoin pass in draft PR #250, based on its reviewed source commit `ac90c4ac`. No backend, credential, deployment configuration, membership or anonymity protocol changes.

## Changes

- Camera and microphone selectors before joining and in a focused in-room settings panel. Choices live only in the current room's memory and clear at the parent room/account boundary. Selection never unmutes or enables capture.
- Explicit local microphone test with input meter, permission guidance and no playback, recording or publication. It stops on mute, settings collapse, hidden page, accepted Join and unmount. Pending captures are stopped when they eventually resolve.
- Exact camera selection in prejoin. A deferred verification callback cannot approve a different camera from the one reviewed at Join.
- Guard the released MoQ SDK's preferred-device fallback. Its default behavior can open system-default hardware before discovery or when a selected device disappears. The new synchronous selection gate waits instead. Live device switching retains the same source, relay, receiver and publication.
- Distinguish usable microphone tracks from intent, as camera readiness already does. Pending, interrupted and failed capture no longer appears as an active microphone. Camera/microphone button labels match the action they actually perform, while separate status explains readiness. Listener roles cannot enable capture.
- Keep device settings out of the six-button media dock. Mobile uses the labelled room-actions menu; desktop exposes settings directly. Existing focus management, capture boundary, pins, gallery, chat and moderation are retained.
- Reset room UI at the parent entry boundary instead of child effect cleanup, so StrictMode replay cannot discard reviewed device or anonymity choices.

## Evidence and limits

Local actual-component DOM tests, actual released-SDK source tests, focused strict TypeScript, hooks lint, verifier and the 1,868-test Node suite pass. Chromium rendered prejoin and in-room host/participant checks pass at ten viewport sizes, including narrow/short phones and landscape; settings selection/close keeps peer playback mounted. Screenshots have been visually inspected. Full aggregate browser and CI results are recorded in the PR after publication.

No physical camera, microphone, Bluetooth routing, Safari permission behavior, authenticated live-room or real two-device continuity has been verified. The input meter measures local input, not whether others can hear it. Speaker/headphone output selection remains in system sound settings. Device controls are web-only; native source behavior is unchanged. Long phone content still scrolls. Nothing here establishes Batemates/Sniffies parity or performance superiority.

## Runnable checks

- `node scripts/test-lynk-device-settings-dom.cjs`
- `node scripts/test-lynk-prejoin-dom.cjs`
- `node scripts/test-lynk-device-selection-sdk.cjs`
- `node scripts/test-lynk-web-capture-sdk.cjs`
- `node scripts/test-lynk-web-capture-ui.cjs`
- `node scripts/test-lynk-layout-browser.cjs`
- `node --test 'packages/app/**/*.test.ts' 'packages/ui/**/*.test.ts'`
- `node scripts/verify-lynk.mjs`

The SDK fixtures use the exact versions in `.github/workflows/lynk-room-regressions.yml`; set `LYNK_SDK_DEPS` to that isolated dependency graph when running without the full workspace install. Browser fixtures require Playwright's version-matched Chromium and use synthetic media/server boundaries.
