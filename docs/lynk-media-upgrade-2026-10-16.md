# Lynk web media dependency migration

## Scope and release pins

- `@moq/publish` 0.2.14 → 0.5.2, with a reviewed local capture patch
- `@moq/watch` 0.2.16 → 0.6.2
- `@moq/signals` 0.1.8 → 0.2.5
- Deprecated `@moq/lite` 0.3.0 → direct `@moq/net` 0.4.3
- Web Fishjam React, TS and WebRTC clients 0.29.0 → 0.31.0 together
- Expo Camera 57.0.5 → 57.0.6 within SDK 57
- Zod and Zod Mini 4.5.0 meet the new MoQ schema packages' runtime peers
- MediaBunny stays at 1.61.5. Version 1.61.6 was published October 16 at
  18:14:11.822 UTC and is not eligible under the 24-hour release-age policy until
  October 17 at 18:14:11.822 UTC.

React remains 19.2.3. We do not import the optional `@moq/signals/react` adapter,
which advertises React 19.3 peers; the application's `useSyncExternalStore` bridge
uses the framework-independent root signals API. No Expo major, native Fishjam,
Vision Camera, relay, production data or credentials are changed.

## Published API migration

The current published npm packages, including their bundled source, declarations
and README examples, were inspected before changing the integration:

- [Publisher source](https://github.com/moq-dev/moq/tree/main/js/publish)
- [Watch source](https://github.com/moq-dev/moq/tree/main/js/watch)
- [Connection source](https://github.com/moq-dev/moq/tree/main/js/net)
- [Signals source](https://github.com/moq-dev/moq/tree/main/js/signals)

`Connection.Reload` is replaced by `Connection`. The new constructor owns its
reconnect loop and origin routing table; the similarly named `Connection.connect`
is one-shot and is not used by room hooks. Publisher and viewer retain separate
scoped token URLs, private connections, zero linger and unlimited recoverable
outage retries. Terminal authorization and source-capture errors surface in the
room state instead of remaining indefinitely reconnecting or falsely live.
A role or token change still withdraws the old publication.

Discovery follows `connection.origin` and the current origin's `broadcasts()` map.
Its computed signal can be undefined before the first microtask or after close;
the React bridge treats that as an empty set. Namespace filtering remains
slash-delimited. Dropped publishers close their complete player.

Publisher devices expose `out.source` media objects. The integration explicitly
owns source computeds, video/audio capture, broadcast, and video/audio encoders.
Audio and video share the connection bandwidth allocator. All are closed
together, in reverse creation order, on role loss, token
revocation, room switch, effect replay and leave. Enabled signals remain gated by
room publishing permission. Local previews read source tracks without acquiring
an additional camera or microphone.

`Watch.Player` replaces `Watch.MultiBackend` and owns its subscription, synchronized
decoders, renderer and audio output. Canvas, mute and volume are supplied as
signals. A zero-millisecond delay retains audio; the SDK's `instant` mode disables
audio and is intentionally not used.

The native WebView fallback uses the same pinned net/watch/signals release family
and supported API. Its prior invalid optional-chain constructor is removed, its
inline configuration is script-safe, and navigation releases all resources.

## Orientation and interoperability

The release on npm predates [upstream PR 5646](https://github.com/moq-dev/moq/pull/5646),
merged October 16 at 18:41 UTC. Installing the latest npm release alone does not
include that change. No unreleased Git dependency is installed.

The orientation correction is ported to 0.5.2's capture processor. Native and
worker processors are used only when both public `VideoFrame` orientation
properties exist. If either is absent, capture selects the HTMLVideoElement
presentation fallback **before** constructing either processor. This matters on
WebKit: its worker frame's display size can remain the raw CV pixel-buffer size,
and its VideoFrame canvas path does not apply the hidden frame orientation.
Rasterizing that unknown frame alone is not a sufficient Safari correction.

For metadata-capable processors, explicit `rotation`/`flip` is rasterized once at
the shared native/worker capture boundary. Only explicitly upright, unflipped
frames retain the no-copy path. Unexpected metadata-unknown frames are also
rasterized defensively; the camera-track capability gate avoids relying on that
defense on WebKit. The fallback paints the video presentation before constructing
a frame, reads live `videoWidth`/`videoHeight` on every capture, and preserves
readiness, demand/backpressure, cancellation, monotonic timestamps and caller
track ownership. No user-agent, device-angle, aspect-ratio or facing-mode guess
changes the received picture.

Primary implementation evidence is pinned to WebKit commit
`7a76e975a330b0754322f49827de7fb8a7844e85`:
[track processor frame sizing](https://github.com/WebKit/WebKit/blob/7a76e975a330b0754322f49827de7fb8a7844e85/Source/WebCore/Modules/mediastream/MediaStreamTrackProcessor.cpp#L195-L216),
[CV pixel-buffer presentation size](https://github.com/WebKit/WebKit/blob/7a76e975a330b0754322f49827de7fb8a7844e85/Source/WebCore/platform/graphics/cv/VideoFrameCV.mm#L664-L667),
and [VideoFrame canvas drawing](https://github.com/WebKit/WebKit/blob/7a76e975a330b0754322f49827de7fb8a7844e85/Source/WebCore/html/canvas/CanvasRenderingContext2DBase.cpp#L1777-L1812).
The [MediaStream video presentation path](https://github.com/WebKit/WebKit/blob/7a76e975a330b0754322f49827de7fb8a7844e85/Source/WebCore/platform/graphics/avfoundation/objc/MediaPlayerPrivateMediaStreamAVFObjC.mm#L1115-L1152) explicitly applies rotation and mirroring, and its intrinsic size swaps for quarter turns. This supports the selected video-element fallback for both pixels and dimensions. This source-backed routing decision does not replace physical-device validation.

The release still advertises the lite-01/02 compatibility handshake when a modern
ALPN is unavailable, and its publisher still emits Hang's legacy timestamp-prefix
container. AVC remains the production codec family, preserving the existing
native receiver contract. The committed Swift pins were also checked: MoQKit
v0.4.1 treats AVC without a description as Annex B; moq-ffi-v0.3.11 accepts the
legacy container and required video/audio fields and ignores additional fields.
See [pinned AVC receiver](https://github.com/software-mansion-labs/moq-kit/blob/v0.4.1/ios/Sources/MoQKit/Subscribe/internal/codec/VideoFrameProcessor.swift)
and [pinned catalog parser](https://github.com/moq-dev/moq/blob/moq-ffi-v0.3.11/rs/hang/src/catalog/root.rs).
These source-level compatibility checks do not replace
an authenticated deployed-relay or physical-device interop test.

## Verification

Record exact final commands/results in the pull request. The regression suite
covers source ownership, asynchronous permission/capture cancellation, token and
role changes, replay, reconnect discovery, encoded pixel orientation, and the
production StageTile. The build guard must reject unpatched installed packages
and unpatched emitted chunks, including same-version warm-cache builds.

A software VP8 synthetic success does not establish AVC support on the test
browser and does not establish success on a physical iPhone or iPad. AVC capability
is reported separately, with an explicit skip if unavailable. No production
room, camera, microphone or real user content is used in synthetic testing.

## Local production-artifact verification

Use `NEXT_PUBLIC_DVNT_LOCAL_BUILD_ONLY=1 NEXT_TELEMETRY_DISABLED=1 CI=1 pnpm --filter web build` for a local production-shaped webpack verification without Sentry transmissions. The opt-in disables Sentry build telemetry, source-map upload, remote release creation/finalization, browser/server/edge SDK event delivery, and Payload usage telemetry. Ordinary production configuration is unchanged. The flag is rejected when `VERCEL=1` or `VERCEL_ENV` is set; never use a local-only artifact as a release artifact. `scripts/test-local-web-verification.cjs` asserts these boundaries.
