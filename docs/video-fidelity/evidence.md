# Video fidelity — evidence matrix

What has actually been run, what failed, and what has not been attempted. A row
is PASSED only if the command was run and its output read.

## Hash criteria in use

- **Pass-through upload:** `SHA256(source) == SHA256(stored)`.
- **Prepared (encoded) upload:** `SHA256(source) != SHA256(prepared)` by design;
  the test is `SHA256(prepared) == SHA256(stored)`, plus a source-vs-prepared
  comparison of resolution and visual fidelity (SSIM/PSNR), not bytes.

## Matrix

| Area | Case | Status | Evidence |
|---|---|---|---|
| **Web** | Post video, 1080×1920 H.264, pass-through | **PASSED** | `98900bd6…32750` source == stored; `ffprobe` diff empty; stored 1080×1920 yuv420p 30/1 |
| **Web** | Post video, 1920×1080 H.264, pass-through | **PASSED** | `0c3729b8…16d5fc` source == stored; stored 1920×1080 30/1 |
| **Web** | Story video, 1080×1920 **60fps**, pass-through | **PASSED** | `96e7d575…637562` source == stored; stored `h264 1080 1920 60/1` |
| **Web** | Stored row records dimensions | **FAILED, then fixed** | First run landed byte-identical with NULL width/height — only the native branch sent them. Fixed in `3af72d3`; **not re-verified by a second upload** |
| **Preparation** | 71.46 MB → 22.39 MB at source dimensions | **PASSED** | SSIM 0.9950, PSNR 43.77 dB avg / 40.95 min, 1080×1920 30/1 preserved, 9s encode (ffmpeg, desktop) |
| **Preparation** | Planner predicts before encoding | **PASSED** | 0.0971 bpp predicted vs 0.04 floor → ENCODE; result confirmed |
| **Policy** | Client and server limit tables agree | **PASSED** | `upload-policy.test.ts` parses the Edge Function source and `deepEqual`s the tables |
| **Unit** | Budget, quality floor, pass-through, unknown metadata, damaged output, container/MIME | **PASSED** | 617 node tests, 0 failures |
| **Types** | `@dvnt/app`, `web`, Edge Function | **PASSED** | `tsc --noEmit` clean both packages; `deno check` exit 0 |
| **Server binary transport** | success / byte counting / wrong declared length / truncation / cancel / retry / duplicate | **NOT RUN** | Harness written (`media-upload/harness.ts`, `deno check` clean). Needs an authenticated request; token export is out of scope by instruction |
| **Prepared → stored hash** | prepared bytes == stored bytes | **NOT RUN** | Requires a prepared file to complete a real upload |
| **Size boundary** | just below / at / just above each cap, client and server, including a request that bypasses client validation | **NOT RUN** | Needs the harness |
| **Timeout budget** | measured throughput vs the 120s outgoing timeout | **NOT RUN** | No large upload has been timed end-to-end |
| **iOS** | Any upload with these client changes | **NOT RUN** | No device build contains them; the production OTA predates all of it |
| **Android** | Any upload with these client changes | **NOT RUN** | Same |
| **Real HDR / Dolby Vision** | camera original → picker → persisted → stored | **NOT RUN** | No genuine sample; cannot be synthesised |
| **Real faces / low light** | quality floor validation | **NOT RUN** | `testsrc2` measures text, gradients and motion only |
| **Streamed PUT to Bunny** | one real streamed object | **NOT RUN** | Deployed but unexercised; a streamed body cannot be retried |

## Fixtures

Synthetic, generated with `ffmpeg 9.0.1` (`testsrc2` + `sine`), manifest at
`fixtures/MANIFEST.sha256`:

| File | Size | Notes |
|---|---|---|
| `portrait_1080p_h264.mp4` | 7.9 MB | the 360×640 regression case |
| `landscape_1080p_h264.mp4` | 8.0 MB | orientation |
| `portrait_1080p60.mp4` | 7.2 MB | frame timing |
| `uhd_2160p_hevc.mov` | 14.6 MB | 4K HEVC in a `.mov` container |
| `small_360p.mp4` | 0.2 MB | already-small clip |
| `oversized_4k.mp4` | 105.6 MB | over every cap |
| `detail_1080p_30s.mp4` | 71.5 MB | quality-floor source |

They prove transport and byte preservation. They **cannot** validate real-camera
metadata, skin tones, or native asset-representation behaviour.

Two were unreachable through the browser automation path, whose file-injection
cap is 10 MB — `uhd_2160p_hevc.mov` and `oversized_4k.mp4`. That is a limit of
the test tool, not of the application.

## Deployed vs committed

| Change | State |
|---|---|
| Original-preservation client + streaming function (`62f7c5f`) | deployed — Edge Function **v82**, client on master |
| Web dimensions fix (`3af72d3`) | on master |
| Bounded counting, truncation detection, orphan cleanup (`b26d94e`) | **committed, not deployed** |
| Budget-driven preparation, limits reverted to 18/25/12 MiB (`70e857e`) | **committed, not deployed** |

The running function is still v82, which has the 96 MiB limits. Client and server
therefore disagree right now until `b26d94e` + `70e857e` are deployed together —
deploy the function first, per the rollout order.
