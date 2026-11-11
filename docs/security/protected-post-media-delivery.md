# Protected post media delivery: staged implementation, not an active privacy guarantee

## Why this is needed

Post/API authorization and the catalogue restriction do not protect a permanent
Bunny URL someone already knows. This draft adds a fresh-authorized delivery
lease, not a claim that those existing URLs have stopped working. No CDN setting,
secret, production migration, release, purge, or stored object was changed by
this draft. Production activation needs separate approval.

The account's actual Bunny token-auth settings, Edge Rules, host aliases and
origin bypasses remain **unverified**. The available cloud dashboard redirects to
sign-in and the connected Mac was offline. There is no Bunny connector. Source
confirms an Edge Storage pull zone, not Bunny Stream; do not apply Stream-only
settings or assume an account configuration from documentation.

## Server contract

`POST post-media-lease {postId: number}` returns `{postId, expiresAt, media}`.
Each media item has `order`, `type`, `url`, and optional `mimeType`, `thumbnail`,
`livePhotoVideoUrl`. `expiresAt` is Unix seconds. The endpoint accepts no URL,
viewer ID, directory, requested expiry, transform, or alternate hostname.

The server verifies Better Auth internally, resolves the viewer, and runs the
production post projection for the current row. Anonymous access is limited to
posts that projection permits publicly; anonymous Spicy/private delivery is
not allowed. Denied, pending, blocked, underage, missing and failed reads issue
no capability. Current owners retain the same ownership rights as the post gate.

A service-only, read-only SQL helper finds *all* posts referencing each source,
thumbnail or motion URL, normalizing stored query/fragment variants, origin casing/default ports, encoded ASCII separators and dot segments. Object paths match conservatively across host aliases; the issuer still signs only the one configured origin. Any denied
or orphan duplicate reference denies the lease, matching catalogue fail-closed
behavior. Overlarge reference sets fail closed. This may cause an availability
failure for reused assets; it does not grant access through a public duplicate.
The helper does not expose private metadata to anon/authenticated database roles.

Remote-only pre-publish handoffs use the same endpoint with
`{uploadMediaIds: number[]}` (one to four IDs). It returns
`{expiresAt, uploads: [{mediaId, url, mimeType}]}` only after matching the verified
uploader to service-written receipts and current media records, rechecking after
signing. Public mutable media rows alone cannot establish ownership. These
owner capabilities let the original uploader preview their own bytes; they do
not grant someone else's uploaded media. Canonical receipt references, not
capability URLs, remain the persistence/submission contract.

Anonymous endpoint delivery is disabled unless a trusted gateway-overwritten
`cf-connecting-ip` or `x-real-ip` header has been independently verified and
selected via `POST_MEDIA_TRUSTED_CLIENT_IP_HEADER`. Missing configuration is 503,
not one global guest bucket. IP hashes provide per-client best-effort burst
limiting; they are not durable quotas or authentication. Direct access must not
permit callers to forge this header. If the hosting gateway cannot guarantee
that, public guest rollout remains blocked pending a trusted proxy/rate-limit
boundary; do not simply configure an untrusted header.

Each permitted asset receives an independent exact-path Bunny **HS256** HMAC
capability. It expires after at most 120 seconds from issuance start. There are
no directory tokens, wildcard scopes, ignored parameters, client transforms or
client-added cache busters. The server rechecks source identity and authorization
after asynchronous signing. Lease JSON is `private, no-store`; secrets and URLs
are not included in error logs. No media bytes are transcoded or recompressed,
so paired Live Photo bytes and metadata remain unchanged. The existing protected-photo-preview renderer uses a short server-only token to fetch its source when origin enforcement is enabled; it still returns only its approved lossy derivative.

Sources:
- Official signer: https://github.com/BunnyWay/BunnyCDN.TokenAuthentication/blob/master/nodejs/token.js
- Official token format overview: https://github.com/BunnyWay/BunnyCDN.TokenAuthentication
- Edge Rule capability overview: https://bunny.net/blog/introducing-the-new-edge-rules/

The duplicate helper covers the tested browser URL alias classes, not arbitrary
provider rewriting. A canonical URL/alias inventory remains an activation gate.
The implementation deliberately supports only canonical HTTPS URLs on the
configured origin under `/post-image/`, `/post-video/`, `/posts/`. Unknown legacy
hosts, encoded aliases and transformation URLs fail closed. Inventory and repair
unsupported variants before activation; never add a raw fallback to make them
appear to work. Provider support for the current official HS256 format must be
verified on the actual staging and production zones before cutover.

## Configuration and activation order

1. Inventory all post source/motion/thumbnail prefixes and aliases, raw-storage
   access routes, image optimizer/proxy routes and public-asset reuse. Do this
   using aggregate metadata; do not expose private files. The existing catalogue
   fix is a prerequisite, not a substitute for origin enforcement.
2. Obtain approval for the read-only helper migration, Edge Function deployment,
   client releases and provider settings separately from this draft. The additive
   migration is `20261111024044_post_media_delivery_parents.sql`.
3. Deploy the endpoint with signing disabled. Its default is 503, never raw URL
   fallback. It needs existing Supabase configuration, canonical
   `BUNNY_PULLZONE_BASE_URL`, a provider-issued `BUNNY_TOKEN_AUTH_KEY`, and explicit
   `POST_MEDIA_DELIVERY_MODE=bunny-hs256` when ready. Never place that key in a
   public client environment or commit it. Setting a key/mode alone does **not**
   activate CDN protection.
4. Validate an approved staging zone with synthetic fixtures. Require HS256 on
   **all** post source, motion, thumbnail and legacy post paths before cache
   delivery, including every alias. Keep unrelated public assets public only via
   narrowly verified non-post path rules. Verify storage/origin cannot be fetched
   anonymously by another host, and no optimizer/proxy can bypass the rule.
5. Release compatible web/native clients with build-time flags
   `NEXT_PUBLIC_FF_PROTECTED_POST_MEDIA` /
   `EXPO_PUBLIC_FF_PROTECTED_POST_MEDIA` initially off. Set the applicable flag to
   the exact string `true` only for the approved staged cutover.
   Exercise feed, profile, detail, search, activity, shared messages, detached
   lightboxes, Live Photos, prefetch and editing/upload flows. Old native versions
   cannot securely retain raw access. Enforce upgrade or accept unavailable media
   on those versions; never disable origin protection for an old client.
6. Enable leases for supported clients, then require tokens on every protected
   production path/alias in the approved change window. Purge old CDN/browser-
   facing public cache entries and use private/no-store browser response headers
   for protected files. Retain CDN caching only if authentication is verified on
   every request *before* cache service. Any unsigned bypass blocks release.
7. Verify approved owner/adult, pending, revoked, blocked, anonymous and minor
   fixtures using only synthetic files. Check images, thumbnails, paired motion,
   video Range/206 and seeking, background/foreground expiry, denied refresh,
   copied URLs before/after expiry, raw old URLs, changed paths/parameters,
   alternate hosts, deleted/replaced sources and cached/offline clients.
8. Record exact provider settings, client versions, fixture results and remaining
   unsupported paths. Do not mark this incident fully resolved solely because
   local tests or the lease endpoint pass.

## Revocation and compatibility limits

An issued URL is a **bearer capability**. A copied valid token can be used until
expiry, up to 120 seconds plus provider clock tolerance. Per-user relationship
revocation stops renewal; it does not revoke a token already issued. An HTTP
transfer admitted while valid may finish after expiry. Immediate emergency
revocation needs an approved provider key rotation/path block and cache purge,
which affects all holders. Session-bound per-request gateway delivery would be
needed for a tighter network revocation boundary.

Already downloaded pixels, screen captures, browser/native disk caches and
legitimately saved files cannot be clawed back. Client cache clearing reduces
accidental redisplay but is not DRM. A token-auth cutover does not erase historic
disclosures. Public derivatives intentionally created elsewhere, including
approved coarse previews, require their own threat model.

Rollback after enforcement must fail closed: turn affected clients unavailable
or roll forward, do not turn off token auth or restore public URLs. Keeping the
read-only helper/disabled endpoint is safe. Removing the helper while a client
uses leases causes unavailable media rather than broadening access.

## Verification

- `scripts/test-post-media-delivery.cjs`: production handler and projection,
  independent HMAC fixture, URL rejection, all media variants, pending/block/
  minor/nonpublic checks, duplicate references, revocation during issuance,
  anonymous public compatibility and no-store/default-off behavior.
- `scripts/test-post-media-delivery-sql.cjs`: actual local PostgreSQL-WASM helper,
  role permissions, canonical duplicate matching, orphans, bounds and no writes.
- `scripts/test-post-media-lease-client.cjs`,
  `scripts/test-post-media-secondary.cjs`, and
  `scripts/test-handoff-upload-lease.cjs` cover compatibility-off, real mounted
  rendering, atomic paired capabilities, expiry/revocation, restoration filtering
  and uploader handoffs. Capability caches are separate from persisted post
  snapshots; renewal begins 20 seconds before expiry. Denial/expiry blanks media,
  and foreground entry discards old sources before reauthorization. Receipt-less
  legacy handoff drafts require reimport. Decode/network failures do not retry
  raw originals; scheduled renewal/foreground reauthorization is bounded.
  Hosted typecheck/browser checks and actual provider/device acceptance remain
  separate release gates; local fixtures do not verify CDN enforcement.
