# Comment GIF rollout

This change has not been deployed, and the migration has not been applied to production. The exact migration has been applied successfully to an isolated minimal PGlite PostgreSQL fixture.

## Order (requires separate deployment authorization)

1. Review and apply `20261022231502_comment_gif_attachment.sql` using the normal migration release workflow. It only adds nullable JSONB metadata and a validation constraint. There is no backfill or storage upload.
2. Deploy `add-comment` and `get-post-comments` with `_shared/comment-attachment.ts` included. Do not deploy these functions before the column exists: their insert/select requires it.
3. Ship the web comment composer and attachment renderer. This change does not add a native GIF picker or require a native app release; shared/mobile API types remain compatible and native rendering has a readable fallback. Old clients continue sending plain text. GIF-only rows store `content = 'GIF'`, so old clients and notification previews remain meaningful.
4. Smoke-test root GIF-only, caption-plus-GIF, reply GIF, failed-send retry, old text-only clients, and malformed attachment rejection in an authorized staging environment before production release.

## Contract

Optional `attachment` contains exactly `provider`, `id`, `url`, `previewUrl`, `width`, `height`, `title`. Providers are `klipy` or `noto`. IDs: 1–128 characters; titles: up to 200; image URLs: up to 2048; dimensions: integers 1–4096. The database also caps serialized metadata to 8192 bytes. URL and preview must belong to the same provider. Only HTTPS images on `static.klipy.com` / `static1.klipy.com`, or existing Noto emoji `fonts.gstatic.com/s/e/notoemoji/latest/{codepoint}/512.gif` URLs, are accepted. Credentials, nonstandard ports, fragments, arbitrary domains, nested payloads and unknown fields are rejected. No GIF bytes are stored or rehosted.

`content` is optional only when a valid attachment is supplied. Existing auth, verified-admission, write-rate checks, thread normalization, count triggers and author/mention notifications are unchanged. Mentions are parsed only from user-entered caption text, never attachment titles.

## Read-only production preflight (2026-10-22 UTC)

Metadata-only SELECTs confirmed that `public.comments` has no attachment column; `content` is non-null varchar; existing depth constraint permits 0–1. Foreign keys, thread-shape enforcement, count synchronization and delete-audit/guard triggers are retained. RLS is enabled.

Existing security caveat: anon has UPDATE and a permissive `comments_update_anon` policy with `USING true` / `WITH CHECK true`. INSERT has a public permissive policy plus the restrictive verified-participation policy. This feature does not modify those preexisting grants or policies. Both database attachment validation and read normalization are therefore necessary; this rollout does not claim that direct comment writes are locked down. Review that unrelated authorization exposure separately before production release.

## Verification

Run on Node 24:

    node --test apps/mobile/supabase/functions/_shared/comment-attachment.test.cjs apps/mobile/supabase/functions/add-comment/attachment.test.cjs apps/mobile/supabase/functions/get-post-comments/attachment.test.cjs

The tests exercise validation and actual handler code with mocked dependencies (not a deployed Supabase instance). The CHECK expression was additionally evaluated in a read-only SELECT against ten literal fixtures (valid Klipy/Noto, SQL NULL, missing fields, invalid dimensions, host, port, scheme and unknown metadata), all matching expected results. Production SQL remains unapplied. The exact migration also passed the isolated fixture in `scripts/test-comment-gif-migration.sql` using PGlite PostgreSQL: existing text, nullable-column creation, valid text/GIF/caption/Noto rows, and 29 invalid metadata cases each rejected for INSERT and UPDATE. A dedicated `comment-gif-migration` CI job runs that fixture with the official PostgreSQL 17 service and psql. Hosted CI execution is pending until the branch is pushed. This minimal fixture does not model production RLS, foreign keys, thread/count triggers, or notification delivery, and does not replace a staging smoke test.

## Rollback

Roll back the client first, then the edge functions if necessary. Keep the additive nullable column and existing data: old function versions ignore it and continue displaying `GIF` content. Do not drop the column as a routine rollback because that would destroy attachment metadata.
