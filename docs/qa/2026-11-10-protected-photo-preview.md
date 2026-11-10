# Actual-photo protected feed preview (draft)

The web feed uses `protected-photo-preview`, an authenticated on-demand Edge
Function. It reads the current post by ID, runs the exact feed authorization
projection, and only processes a returned locked Spicy placeholder. Private
profiles, blocked members, nonpublic posts, signed-out/age-ineligible viewers,
and failed authorization checks receive no preview. Instagram-private posts
remain excluded from nonfollowers' feeds: this change does not broaden that
privacy contract.

The server fetches only post-image paths on the existing configured
BUNNY_PULLZONE_BASE_URL, rejects query transforms/credentials/redirects, bounds
bytes (10 MiB), time (8 seconds) and dimensions (4 MP). It decodes a supported
still, irreversibly averages it to 6x6 quantized color cells and reconstructs a
48px Gaussian-blurred PNG. Only those new pixels reach the browser. No original
URLs, EXIF, client-authored placeholders, reversible CSS blur or third-party
image processing/uploads are used. Removing CSS cannot reveal the original.

This necessarily reveals coarse colors/composition of an otherwise locked
photo; it is not a guarantee that no subject can ever be inferred. No real-photo
preview can honestly offer that guarantee. Do not expand it to private accounts
without a separate explicit product/privacy decision.

Existing and new posts work on demand without modifying media rows or a bulk
backfill. Unsupported/legacy paths, oversized images, video-first posts,
animated WebP/HEIC/GIF, missing backend configuration or processing failures
retain the abstract placeholder. JPEG/PNG/still WebP are supported by a
pinned ImageScript 3.20.2 dependency (MIT license option), with decoder-level
maxPixels protection in addition to header checks. All responses are private/no-store; subsequent
requests reauthorize. Client async work is bound to the account/session and
cleared on changes. Existing feed access invalidation governs mounted tiles.

Deployment requirements: deploy the new function with the checked-in internal
Better Auth verification configuration and existing Bunny pull-zone environment.
No database migration, credential change, paid service or upload is required.
This PR does not deploy or change production configuration.

Local checks: protected preview contract tests, existing gate/UI suite, 49 server
access tests and diff whitespace checks. Node runtime tests exercise the pinned ImageScript PNG/JPEG/WebP codec and decoder pixel limits.
Real Deno 2.9.6 tests also pass for PNG/JPEG/WebP decoding and 4MP input
allocation/reduction (142ms encode/decode/reduction on the test machine).
Independent review prompted a post-processing access/source recheck, now covered
by a revocation-during-encode test. Chromium component coverage is included in CI
for account/session races, post changes, rejected original URLs and failures.
Actual deployed Supabase limits and signed-in live-backend browser verification
remain release checks. Local Chromium launch is blocked by the execution sandbox
socket restriction, so hosted browser results must be checked.
