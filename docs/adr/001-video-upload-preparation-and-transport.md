# ADR 001 — Video upload: preparation policy and transport

Status: accepted, partially deployed
Date: 2026-09-17

## Context

Every post, story and event video published from a phone was stored at a
fraction of its pixels, and the source was deleted after upload.

`use-media-upload.ts` called `compressVideo()` unconditionally and refused to
upload without it. `compressVideo()` called `react-native-compressor` with
`compressionMethod: "auto"` and **no `maxSize`**. That library defaults `maxSize`
to 640 (`node_modules/react-native-compressor/lib/commonjs/video/index.js:47-51`)
and scales the **longer edge** (`ios/Video/VideoMain.swift:187`), so 1080×1920 was
published as **360×640** — 91% of the pixels gone. The `1280×720 / 1.4-2.0 Mbps`
"target" documented in that file's header was never passed to the encoder; those
constants were referenced only by a `console.log`.

Production agreed: 179 video rows, average 4.0 MB, and `width`/`height` NULL on
every single one — nothing recorded what it was serving.

A second helper (`media/compress-video.ts`) used `maxSize: 1080`, which is the
same mistake one tier up — a 1080px longer edge, i.e. 608×1080 for portrait. It
was dead code with no importers, carrying a third and fourth set of size limits
(32/28 MB) that disagreed with both the client and the server.

## Decision

**Resolution never gives. Bitrate does.**

1. **Small budgets are kept**: story 18 MiB, post 25 MiB, message 12 MiB;
   event-video held at 50 MiB pending its own measurement. Raising limits to
   avoid compressing was rejected — it moves the cost onto members' storage and
   data rather than solving the problem.
2. **A clip inside its budget is uploaded untouched.** No encoder runs.
3. **A clip over budget is encoded at its own dimensions.** `planVideoUpload()`
   computes the video bitrate from measured duration and dimensions, pays for
   audio and container first, and passes the source's own longer edge as
   `maxSize` — `manualCompressionHelper` only scales when the source *exceeds*
   `maxSize` (`ios/Video/VideoMain.swift:222-229`), so dimensions and aspect
   ratio survive.
4. **A quality floor sits beside the ceiling.** Below ~0.04 bits per pixel per
   frame, H.264 smears faces and stops resolving text. A clip that cannot hold
   the floor inside its budget returns `too_large` *with the duration that would
   fit*, so the member trims or exports smaller. It is never encoded anyway.
5. **Unmeasurable metadata passes through.** An unknown is not a licence to
   shrink someone's footage; the size limit then refuses it with a clear message.

### What the encoder can actually do

`react-native-compressor@1.16.0` exposes exactly `bitrate`, `maxSize`,
`compressionMethod`, `minimumFileSizeForCompress`, plus cancellation and progress
(`lib/typescript/video/index.d.ts`). There is **no** codec selection, **no**
constant-quality/CRF mode, **no** HDR flag and **no** frame-rate control.
Therefore nothing in this design promises HEVC, CQ or HDR preservation *through
an encode*. Audio is not negotiable either: the exporter always re-encodes to AAC
128 kbps stereo 44.1 kHz (`ios/Video/VideoMain.swift:271-274`), so it is a fixed
line item in the budget rather than an estimate.

Web has no encoder at all — `react-native-compressor` is native-only — so an
over-budget file on web is reported, not silently shipped to be refused.

## Measured evidence

30s 1080×1920 detail-heavy source, post budget (25 MB):

| | Source | Prepared | Old 640 default |
|---|---|---|---|
| Size | 71.46 MB | **22.39 MB** | 3.71 MB |
| Dimensions | 1080×1920 | **1080×1920** | 360×640 |
| Frame rate | 30/1 | **30/1** | 30/1 |
| SSIM vs source | — | **0.9950** | n/a (different resolution) |
| PSNR vs source | — | **43.77 dB** avg, 40.95 min | — |
| Encode wall time | — | 9s (ffmpeg, desktop) | — |

The planner predicted 0.0971 bits/pixel/frame against a 0.04 floor *before*
encoding; the result confirmed the decision rather than discovering it.

## Transport

The Edge Function stays in the path: Bunny Edge Storage has no client-safe
credential, so a server must hold the AccessKey.

- **Native** uploads video as `BINARY_CONTENT` via `expo-file-system`'s
  `createUploadTask` — file-backed, streamed from disk, never through JS. Images
  keep multipart.
- **The function streams** `req.body` to Bunny instead of buffering. A 256 MB
  isolate cannot hold a large original plus a copy for `fetch`.
- **Bytes are counted while forwarding** by a pass-through `TransformStream` that
  preserves backpressure and holds only the chunk in flight. Crossing the limit
  errors the stream mid-transfer.
- **The declared length is a claim**, never the size — on web a browser cannot
  set `Content-Length` at all. Forwarded bytes are compared against it; a
  mismatch deletes the stored object and fails the request.
- **Orphans are cleaned up**: a truncated upload or a failed DB insert deletes
  the object, whose key otherwise exists only in that request's scope.

### Provider capabilities, verified in Bunny's docs

- `Checksum` request header **exists**: "SHA256 checksum uploaded content in HEX
  format (UPPERCASE)", and the server will "compare final SHA256 checksum reject
  request in case checksums do not match."
- Edge Storage PUT is **not resumable**: whole-file PUT, only `201`/`400`
  documented, no Range/offset/session parameters. **Restarting an upload is not
  resuming it**, and nothing in this design claims resumability.

### Retry semantics

Retries are client-initiated from the file URI — a whole-file resend, not a
resume. A streamed body cannot be retried inside the function (a stream is
consumed once), so the retry loop covers only the buffered image path; the
streamed path fails fast and the client resends. Duplicate publishing is
prevented at the post level by `operationId` in the publish queue, not at the
media layer: each upload mints a fresh storage key.

## Alternatives rejected

- **Raise limits to 96 MiB and store originals.** Tried, then reverted. It
  avoids the compression problem rather than solving it, and pushes the cost onto
  members' data plans and storage.
- **Bunny Stream tus resumable upload.** Genuinely resumable and device→Bunny
  direct, but the repo does not use Bunny Stream, and adopting a second media
  product to fix an encoder default is disproportionate.
- **Supabase Storage resumable uploads.** Media lives in Bunny; introducing a
  second storage backend for one path would split the CDN story.
- **Client-side SHA-256 for the `Checksum` header.** No installed API can do it:
  `expo-file-system` offers MD5 only (`File.types.d.ts:110-120`), and
  `expo-crypto.digest()` takes a TypedArray, i.e. the file through JS. A native
  seam (Nitro HybridObject) would be required. Deferred — and deliberately not
  made a prerequisite for fixing compression.

## Known limitations

- **No HEVC, no CQ, no HDR through an encode** — the installed encoder has no
  such controls. A pass-through preserves whatever the source was; an encode
  produces H.264.
- **Streamed PUT is unexercised.** Deployed (function v82), but no video has
  gone through the streaming branch; the harness cases have not run.
- **Legacy content cannot be recovered.** Detail already discarded from existing
  posts and stories is gone; upscaling or a new setting cannot bring it back.
- **Quality floor is a heuristic**, calibrated on synthetic detail. It has not
  been validated against faces, low light or HDR footage.
