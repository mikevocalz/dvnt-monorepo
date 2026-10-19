# Browser original-image byte boundary

These tests characterize the ordinary browser image path. They are diagnostic
coverage, **not a fix or acceptance proof for single-file Apple Live Photos**.
No production media logic is changed.

## What is covered

- Real browser intake preserves every byte of a selected File as a blob URL.
- Intake classifies these JPEG files as ordinary images, not Live Photos. A
  metadata marker alone must not invent an associated motion asset.
- The production multi-upload hook sends untouched ordinary images through
  `expo-image-manipulator` with rotate 0, resize width 1440, JPEG quality 0.85.
- The production server uploader sends the resulting derivative in multipart
  form data. Given the original URI directly, that same uploader preserves it.
- An explicitly supplied pair takes the existing original-pair path and posts
  both byte-identical components without the ordinary image encoder.
- Empty images, unsupported image MIME types and images over the post-image cap
  are refused. The upload client's size check also refuses an oversized original
  before invoking the endpoint.

## Run

Fast production control-flow and multipart contract:

```sh
node scripts/test-browser-live-photo-original-contract.cjs
```

This test deliberately adapts the image encoder to return distinct synthetic
bytes. It proves which URI and bytes reach POST, not browser image decoding.

Actual encoder and Chromium characterization:

```sh
node scripts/test-browser-live-photo-original-boundary.cjs
```

Requires the app-pinned `expo-image-manipulator` package (currently 57.0.18),
`esbuild`, `playwright`, `@supabase/functions-js`, ffmpeg and Chromium/Chrome.
The Feed media motion workflow installs these in isolated test prefixes and
runs both tests. Expo's web encoder and canvas actions are real; React/native
object lifecycle, authentication, thumbnail generation and the receiving upload
endpoint are isolated test adapters. The browser's network is restricted to the
local fixture origin, and a page CSP additionally blocks external connections.

`--build-only` checks bundling without browser execution. `--require-originals`
adds an intentionally failing preservation assertion on the current code, to
make the selected-file/POST mismatch visible. Do not treat the characterization's
normal success as a fix for that mismatch.

## Limits

Fixtures are generated test-pattern JPEGs and a short H.264 MOV. The metadata
case uses a clearly labeled JPEG comment sentinel, not asserted Apple MakerNote
metadata. The trailing-payload case concatenates JPEG+MOV bytes only to prove
loss of non-raster bytes; it is **not asserted to be an Apple export or Android
Motion Photo container**. No personal media, production data, downloads or
credentials are used. The tests cannot establish what any previous user upload
contained, recover an absent companion video, or prove native-iOS picking or
playback. A browser-provided still alone is not enough to establish a playable
Live Photo.
