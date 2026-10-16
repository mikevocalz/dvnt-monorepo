# Web camera dependency upgrade validation

Base: `ae86aad7c9a56b09da75c25ca52058261a8d5bfd`. Checked October 16, 2026.

## Eligible changes

- All three web Fishjam packages, `@fishjam-cloud/react-client`, `@fishjam-cloud/ts-client`, and `@fishjam-cloud/webrtc-client`: 0.29.0 → 0.31.0. Published September 30.
- Expo Camera: `~57.0.5` → `~57.0.6` in the shared app and native manifest. Published September 29; this stays within SDK 57. It is not a Lynk rotation fix.
- Native Fishjam and Vision Camera versions are unchanged.

Fishjam is used by ordinary web calls and video rooms. Sneaky Lynk uses the separate MoQ path. Fishjam fixes must not be described as fixing Lynk camera orientation.

Primary sources:

- https://github.com/fishjam-cloud/web-client-sdk/releases/tag/v0.31.0
- https://github.com/fishjam-cloud/web-client-sdk/pull/611
- https://github.com/fishjam-cloud/web-client-sdk/pull/612
- https://registry.npmjs.org/@fishjam-cloud%2Freact-client
- https://registry.npmjs.org/expo-camera

## Local fixes and coverage

The application now independently releases both SDK devices and their captured tracks during explicit hangup and navigation/unmount. A failed disconnect or camera teardown cannot prevent microphone cleanup. Camera selection now propagates the SDK's resolved `DeviceError` instead of falsely reporting a successful flip.

For the start/toggle/select device APIs used by this application, the pinned Fishjam React SDK patch prevents a camera/microphone permission result from leaving live capture after navigation, explicit stop, or a newer acquisition request. Existing capture is disposed on provider unmount. The SDK's separate `initializeDevices()` API has its own shared-stream owner and is not covered by this patch; the application does not call that API. The patch modifies the published JavaScript only; public APIs are unchanged. Keep the exact patch target pinned until an upstream release supplies equivalent behavior and the regressions pass without the patch.

`node scripts/test-web-call-sdk.cjs` exercises the installed SDK hooks with React. Only browser device acquisition and SFU transport are fixtures. It covers:

1. Camera acquisition that finishes after room joining publishes exactly once.
2. Muting during microphone replacement remains muted; unmute works afterward.
3. Camera permission denial reports failure and preserves the current camera.
4. Repeated camera off/on releases then republishes capture.
5. Navigation releases both devices and removes SDK listeners.
6. Explicit stop cancels a pending camera acquisition.
7. Out-of-order device acquisition preserves the newest camera.
8. Superseded permission rejection cannot overwrite a newer successful camera.
9. Late camera and microphone results after unmount are immediately stopped.

Five additional React cases run the reconnect effect extracted directly from the production screen. They verify status transitions during recovery, unmount during join and microphone acquisition, leave during token admission, and camera-denied audio-only recovery.

The SDK suite fails against 0.29.0 on the camera-join race, and against pristine 0.31.0 on late capture cleanup. It passes against patched 0.31.0. This is asynchronous SDK/state coverage in jsdom, not physical-device WebRTC validation. CI installs the exact app SDK with a 24-hour age gate and applies the committed patch.

The focused call/media Node suite passed 69 tests, including camera selection, teardown, join dependencies, upload policy and preparation/quality checks. Cancellation/error-aware startup prevents late permission responses from updating a reset call store; rejoin checks cancellation after every asynchronous step. The new TypeScript helpers passed a focused strict compile. An isolated pnpm 10.32.1 install with the 24-hour age gate applied the committed patch, the nine SDK cases passed against that installed tree, and its frozen reinstall passed. Final combined lockfile, full build and CI validation are tracked by the combined upgrade change.

A generated real 111 MiB portrait MP4 fixture was prepared locally for the existing browser conversion test, but local Chromium launch was blocked by the environment's socket sandbox; the approved escalation failed in environment setup. Do not count this as a browser conversion pass. The existing Event flyer preparation workflow runs that real encode, verifies dimensions/frame count and byte-identical AAC packet copying, and tests cancellation.

## MediaBunny follow-through after age gate

Retain MediaBunny 1.61.5 in the immediate upgrade. Registry metadata records 1.61.6 at `2026-10-16T18:14:11.822Z`; the earliest 24-hour-eligible time is **October 17, 2026, 18:14:11.822 UTC** (2:14:11.822 PM New York).

Sources:

- https://registry.npmjs.org/mediabunny
- https://github.com/Vanilagy/mediabunny/releases/tag/v1.61.6

After that time:

1. Recheck the published version and age, then update `packages/app/package.json` to exact `mediabunny: "1.61.6"` and regenerate the lockfile with the repository-pinned pnpm version and unchanged package-age policy.
2. Run frozen install and the event-flyer preparation workflow against the final commit.
3. Run `scripts/test-event-video-browser.cjs` for real MP4 output, frame/dimension/audio preservation, pass-through and cancellation.
4. Additionally exercise a non-AAC MOV input requiring AAC encoding in Safari/WebKit. The existing AAC packet-copy test does not exercise an AAC encoder-description workaround. Verify output audio is AAC, channel count/sample rate and duration are preserved, sound is present, and interrupted conversion does not return partial output. Record unsupported encoder capability as a limitation, not a pass.
5. Do not claim this upload/transcode patch fixes live camera rotation.
