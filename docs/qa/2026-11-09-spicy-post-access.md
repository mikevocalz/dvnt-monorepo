# Spicy post read authorization

Spicy originals require following the author on every page, including Public pages. Private profiles require an approved request plus the follow row. The existing signed-in age/admission gate and author access are preserved. Blocks in either direction deny access. Private safe posts also require approved follow access.

## Server contract

`get-posts` serves feed pagination, profile posts, and direct post detail. All service-role readers use `projectVisiblePosts`. Eligible nonfollowers receive only an allowlisted placeholder: ID, author, timestamp, `isSpicyLocked: true`, no caption, location, media URL, theme, or text slide. Ineligible/blocked viewers receive no post. Authorized rows carry `isSpicyLocked: false` and `spicyAccessViewerId` derived exclusively from the verified session. Failed privacy/relationship reads fail closed, including a missing approval migration.

The same guard protects bootstrap feed/profile, bookmarks, liked activity, text slides, notification thumbnails/comment previews, public live-surface tiles, and post comments. Comment creation checks the parent before reading replies or writing. Successful private reads use no-store headers. Database protections and public share metadata are provided by the accompanying post-follow migration.

Client reads never fall back to direct sensitive queries. The detail hook no longer resurrects a cached post after a server denial. Bootstrap writes reject late responses for a changed viewer or feed mode. Old persisted post/activity/notification/bookmark caches are evicted with buster v13. Privacy changes clear in-flight and cached authorization through the follow-access reset helper.

## Verification

- `NODE_PATH=/tmp/dvnt-weekly-tools/node_modules node --test scripts/test-spicy-follow-server.cjs`: 35 passing real projection/handler tests, including Public nonfollowers, private raw vs approved followers, malformed preferences, minors, denylist, blocked pairs, lookup errors, own posts, direct identity spoofing, revocation, comments, and denied child reads.
- Existing add-comment/get-post-comments attachment and bootstrap-notifications schema tests: 17 passing.
- Existing Spicy create/update/legacy tests: 26 passing.
- `node scripts/test-post-comment-counts.cjs`: passed.
- `NODE_OPTIONS=--max-old-space-size=8192 tsc --noEmit -p packages/app/tsconfig.json`: passed. Default 2GB heap was insufficient.
- Existing post-social-actions script could not bundle React Native Flow syntax in the offline harness. This is not claimed as a pass.

## Release requirements

Source changes only. Apply the reviewed follow-request and restrictive read migrations and deploy the changed service readers (including new `get-posts`, configured `verify_jwt=false` because it verifies Better Auth itself) before shipping the client. Deploy the user-settings CAS/canonical-privacy preservation handler and drain all older in-flight invocations before installing the privacy sync trigger. Include the follow-access reset helper. See the [combined release order](2026-11-09-weekly-fixes.md). No database migration or deployment was performed for this work.

These policies prevent unauthorized API disclosure. They cannot retract media already delivered to an authorized viewer or make existing public CDN URLs expire. Private signed asset delivery/rotation requires a separate storage/CDN rollout; do not describe these source changes as revoking already-known URLs.
