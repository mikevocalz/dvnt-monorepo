# Protected post media catalogue

## Confirmed source defect

`media-upload` stores source URLs in both the central `media` catalogue and post attachments. Existing post SELECT policies protect `posts_media`, but the central catalogue's public SELECT policy remains permissive. A synthetic anonymous SQL test reproduces private media URL discovery from the catalogue while both the parent post and its attachment are hidden.

## Candidate correction

A restrictive `media` policy applies the existing follow/privacy and age gates to source URLs, Live Photo motion URLs and thumbnails. Matching ignores query and fragment suffixes. Hidden/nonpublic/orphaned parent posts cannot expose duplicate catalogue records. Reuse on any inaccessible post fails closed. Existing public non-post assets stay unchanged. Unlinked post uploads (including the interval before publication) require a matching service-issued uploader receipt. No rows are deleted or rewritten.

## Verification and rollout

Run `NODE_PATH=<isolated deps>/node_modules node --test scripts/test-protected-media-catalogue.cjs scripts/test-weekly-post-follow-sql.cjs scripts/test-private-follow-requests-sql.cjs`.

The new fixture proves the pre-fix leak, then anonymous/stranger/pending denial, owner/approved access, block and unfollow revocation, source/motion/thumbnail variants, nonpublic posts, asset reuse and unlinked uploader access. Existing follow SQL coverage also passes. CI includes the new test.

Migration is source-only and must be approved/applied separately. It adds expression indexes; schedule appropriately for catalogue/attachment size because ordinary index creation can hold locks. Requires existing follow and spicy helpers, upload receipts and post media schema. Does not depend on profile-display PR #269.

## Remaining boundary

This prevents a new outsider discovering protected URLs through the catalogue. It does not revoke a CDN URL someone already possesses, remove browser caches, or establish the cause of Micah's reported follow-click reveal. Source upload URLs have no per-viewer expiry/signature. Full origin privacy requires separate protected delivery and migration of existing public objects; simply putting a proxy in front leaves the original URL usable. No live content was fetched for this fixture.
