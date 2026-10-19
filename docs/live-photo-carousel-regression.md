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

Post `/post/677`, created at 19:50:20 UTC after #136 deployed, likewise contains
one JPEG with null paired-video/MIME fields. Its upload inventory in the
19:45–19:52 window contains only one `image/jpeg` record. The production alias
was verified on #136's merge commit, so this is not evidence that the patch was
undeployed. It also does not prove which picker control the reporter used.
An ordinary browser still upload produces exactly this record shape. The stored
publish request for 677 also contains only `{type: "image", url: "…jpg"}`:
no motion/MIME fields were supplied to persistence. Read-only inspection of the
deployed `create_post_idempotent` definition confirms it preserves both fields
when provided, rather than silently stripping them.

The initial separate photo/motion import controls were rejected as redundant.
The follow-up uses one media input and optional inline association of motion
files actually supplied by the user. It cannot extract an absent Photos resource.

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

The browser composer has one Photos or Videos input. Ordinary files need no
additional step. If a selection supplies both photos and motion clips, an inline
Motion selector associates a user-chosen pair and merges its two cards into one
LIVE item. Association can be reversed. There is no separate Live Photo upload
button and no filename-based pairing or claim to verify Apple's embedded IDs.
Both original file bodies are retained in a pair, using the existing paired-video
column. A browser selection containing only a JPEG remains a still. Up to twenty
originals can be reviewed to build ten pairs, but publication remains limited to
ten media items. Share is blocked while intake or association is pending.

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

- #136 passed 1,397 repository Node tests, all eight PR workflows, full monorepo
  TypeScript in CI, production web build/bundle budgets, and both postmerge
  workflows. Local native-package TypeScript exceeded memory, but CI completed
  that check. Follow-up validation must be recorded separately.
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

## Upload request budget

The real media-upload handler permits ten requests per minute per user/instance.
Each pair consumes two requests; the original adapter-only roundtrip did not
exercise that limiter. Web uploads now serialize requests and retry only an
explicit rate refusal once, honoring Retry-After when available or waiting sixty
seconds for the current known refusal. Longer-than-two-minute instructions fail
without an early retry; unknown network/storage failures are never automatically
replayed. Session changes abort queued/retried requests. Waiting status reaches
the publication queue. No backend rate policy or deployed function was changed.

The new real-handler regression executes media-upload and its actual limiter,
using simulated time and isolated identity/media DB/Bunny adapters. It proves
ten original pairs, retry retention, refusal handling and account-switch safety,
not production CDN writes.
