# Live Photo carousel regression

## Production observation (read-only, 2026-10-19)

The reported post `/feed/post/673` was created at 18:41:39 UTC. Its four
`posts_media` rows are ordered 0–3, all `type=image`, with JPEG URLs and null
`live_photo_video_url` / `mime_type`. The corresponding media-upload inventory
contains four `image/jpeg` uploads immediately before publication; no motion
upload record was found for that uploader in the surrounding 18:35–18:43 window.
The first CDN object was retrieved successfully and identified as a 1440×1920
JPEG, not a motion container. No database, storage or post changes were made.

The reporter confirmed this selection was uploaded in a browser. This establishes
that the saved browser upload has no motion source available to its renderer,
but does not prove there are no unindexed storage objects elsewhere.
A rendering fix cannot recover motion from those JPEGs. Repairing this specific
post requires the original pairs or a newly uploaded selection, with separate
authorization to change the post.

## Independently confirmed code defects

- Web detail's carousel discarded the paired-video field and rendered valid
  Live Photos as ordinary images.
- Native detail enabled playback on every slide. Ordinary videos in a mixed
  carousel also lacked a video renderer.
- Shared/native generic picker defaults requested images/videos but not Live
  Photos. Expo's iOS multi-selection handler only reads `PHLivePhoto` paired
  resources when `livePhotos` is requested. Explicit still-only callers must
  remain still-only. The primary native post composer already opted in, so this
  generic default is not proof of the reported post's upload route.

## Ingestion invariants

A Live Photo remains two original files through picking, draft persistence,
upload, serialized retry and publication. A failed/missing paired upload must
never publish just the still. Browser file inputs that provide only a JPEG
cannot supply a paired resource, and the application must not invent one.

## Supported browser import

The browser composer offers an explicit still + motion pair, with the user
choosing which two files belong together. It does not infer pairing from names
or claim to verify Apple's embedded asset identifiers. Both original file bodies
are retained, and the saved record uses the existing paired-video column. A
browser selection that contains only a JPEG remains a still.

Native iOS can obtain paired resources directly from Photos. Expo documents that
`livePhotos` is ignored on Web and Android, while the native iOS picker returns
an untouched image and `pairedVideoAsset`:
https://docs.expo.dev/versions/latest/sdk/imagepicker/

Apple documents exporting a Live Photo's unmodified original as two files:
https://support.apple.com/en-au/guide/photos/-pht6e157c5f/mac

Container extension does not guarantee codec support: MOV can contain HEVC that
is not decodable by every browser. The explicit import checks motion readiness
and reports unsupported clips instead of pretending a static fallback is a
successful moving upload. No server transcoder is introduced by this change.

## Validation and limits

- All 1,397 repository Node tests pass; full web TypeScript and focused native
  component TypeScript pass. Full native-package TypeScript was killed by local
  memory pressure, so that aggregate check is not reported as passed.
- Real React DOM/native-bridge tests exercise first autoplay, both swipe
  directions, late callbacks, background/visibility, modal handoff, source
  replacement, mixed media, missing motion, and original-file import cancellation.
- `scripts/test-live-photo-roundtrip.cjs` exercises the actual upload client and
  Supabase multipart serialization, production create-post handler, checked-in
  idempotent PostgreSQL function in isolated PGlite, and fresh API read/renderer
  mapping. Identity/admission and the entire media-upload/storage endpoint are
  test adapters; this is not production CDN/ingestion acceptance.
- `scripts/test-live-photo-roundtrip-browser.cjs` uses generated JPEG/H.264 files,
  actual selectors, upload roundtrip and persisted page reload before checking
  real media clocks. It runs in CI with Chrome; local build-only does not prove
  browser playback. Local Chrome launch is blocked by the execution sandbox.
- Native Apple pairing/decoding and physical iPhone Safari remain device-QA
  boundaries. Browser codec support is checked per selected clip, not inferred
  from MOV/MP4 extension. No production post or storage record was modified.
