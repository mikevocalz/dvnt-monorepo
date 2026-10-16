# Sneaky Lynk remote orientation: build and transport verification

## Confirmed production artifact failure (2026-10-16)

The production deployment at commit `ae86aad7c9a56b09da75c25ca52058261a8d5bfd`
served the original, unpatched publisher capture implementation, although the
repository patch and lockfile included #117 and #119.

- Deployment: `dpl_74HYQQqzM4Ds2ivqiQLVj4NKCuzH`.
- Both public aliases served `/_next/static/chunks/99207.32766e4fa63bb6d6.js`.
- Chunk SHA-256: `7b09beadc36ab8a81b37ce41bb1b4a55a2a9bd443553937e1a8f7df2b74afab5`.
- The room page entry `page-412af67e2685d08b.js` references chunk 99207; the
  deployed webpack runtime maps it to the hash above.
- Its processor branch enqueues a frame directly. Its fallback wraps the video
  element directly in `VideoFrame`, with no orientation normalization or rendered
  canvas capture. This is a semantic source check, not only a missing-name search.

Independent cold, warm, and externally updated frozen-lock installs with the
production pnpm 10.32.1 and `node-linker=hoisted` all applied the committed patch.
Deployment logs show a restored build cache. A real webpack regression reproduces
stale module reuse when bytes inside a managed node_modules package change without
changing its package version/path. Fingerprinting patch bytes in the existing
webpack cache version fixes that reproduction. The exact remote cache contents
are unavailable, so cached module reuse is the supported mechanism, not a direct
inspection of the original Vercel cache.

## Build safeguards

1. Resolve the publisher from the app importer and validate the actual installed
   capture call sites and helper against every committed patch postimage hunk.
2. Include the patch SHA-256 in the existing webpack filesystem cache version;
   preserve Next's existing cache configuration and build dependencies.
3. After the web build, reject emitted client publisher chunks without both
   orientation fixes. Scan executable `.js`, not source maps.
4. Trigger Vercel builds for patch/guard changes and pin the patched publisher to
   0.5.2 so a routine dependency refresh cannot silently leave its exact patch.

## Transport regression

Run `node --test scripts/test-lynk-orientation-build.cjs` for cache, installed-byte,
and emitted-client gates. Run `node scripts/probe-lynk-remote-video.cjs` with the
probe dependencies installed and the production patch applied. Optional variables:

- `LYNK_PROBE_DEPS`: isolated dependency directory.
- `LYNK_CHROMIUM_PATH`: Chromium executable.
- `LYNK_REQUIRE_AVC=1`: fail closed unless a production AVC candidate is supported.
- `LYNK_WIRE_VERSION=1` or `2`: negotiate the older protocol through legacy SETUP;
  the default is version 3. Each side asserts its negotiated version.
- `LYNK_PROBE_HIDDEN_ORIENTATION=0`: skip the normally enabled missing-getter
  regressions for debugging only. The upgraded SDK can choose WebKit worker
  capture, where orientation getters are absent.

Two independent browser documents communicate via transferable byte streams.
Only the WebTransport boundary is replaced (moq-lite-03); real MoQ control/catalog/container
serialization, publisher encoding, watcher decoding, and SDK canvas rendering run.
No VideoFrame or SDK object crosses the connection. Generated quadrant pixels are
compared against the sender's HTMLVideoElement self-preview. Forty-nine scenarios cover main-thread processor, real Worker frame transfer,
and video-element fallback capture, including present-but-undefined orientation
getters, absent orientation properties, live dimension changes, and rotation/flip
changes after the first keyframe. Catalog, resolved codec, frame
sizes, decoded frame count, and receiver pixels are recorded without user media.

The upgraded publish 0.5.2/watch 0.6.2 Chromium run passed all 49 scenarios using
VP8 with explicit Capture/Encoder and Watch.Player. Every production AVC candidate
(high/main/baseline, hardware/software) was unavailable;
the required-AVC gate correctly fails. VP8 results do not establish AVC behavior.
The harness covers the SDK renderer canvas, not the production StageTile React DOM,
and generated pixels do not reproduce physical iPhone/iPad camera capture.

The present-but-undefined getter worker regression failed before the defensive
normalizer fix: a 64×128 correct self-preview arrived remotely as 128×64 unrotated
pixels. Zero-copy now requires explicitly zero rotation and false flip. That
proves Chromium's internal-frame rendering behavior, not WebKit's VideoFrame
rendering semantics.

For browsers where either orientation property is absent, capture instead selects
the rendered HTMLVideoElement path before starting any native processor or worker.
All 14 missing-property transport cases verify zero processor/worker activity and
positive video-to-canvas rasterization counts, excluding self-preview sampling.
That routing assertion fails on the earlier strict-normalizer-only patch.

The worker fixture simulates only the camera source; native VideoFrames cross
real Worker.postMessage transfers into the SDK worker bridge before encoding and
remote delivery. No test claims a physical WebKit camera reproduction.

Seven fallback capture/catalog/media cases also pass for each of moq-lite-01 and
moq-lite-02, using the actual legacy SETUP exchange. Both endpoints use the new
SDK forced to the older wire version; this is not a native-client interoperability
test, and AVC remains unavailable.

## Release verification still required

After an explicitly authorized deployment, verify the actual room-referenced
public publisher chunk contains both fixes, then test two physical iOS browsers
with fresh loaded code. Record only non-sensitive build/codec/dimension/rotation
metadata. A correct self-preview alone does not verify the encoded remote path.
No CSS angle heuristic or unverified device rotation guess is part of this change.
