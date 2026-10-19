# @dvnt/cms

The DVNT Payload v4 CMS **core** — the single source of truth for the
`payload.config`, all collections, access control, fields, custom endpoints,
generated types, and the admin UI components.

## Who consumes it

- **`apps/web`** (Next.js, CommonJS) — runs the admin at `/admin`, REST/GraphQL
  at `/payload-api/*`, the moderation console at `/console`, and the blog
  (Payload Local API). `@payload-config` resolves to this package's
  `src/payload.config.ts`; the admin import map imports `@dvnt/cms/components/*`.
- **`apps/web-vite`** (Vite, ESM) — CLI / migration runner only. Its
  `payload.config.ts` just `export { default } from '@dvnt/cms'`. apps/web is
  CommonJS and can't load the ESM-only Payload CLI, so migrations run here.

This package is `"type": "module"` so the ESM-only Payload CLI loads it.

## Running the CLI / migrations

```bash
pnpm --filter web-vite generate:types     # regenerate src/payload-types.ts
pnpm --filter web-vite migrate:create      # create a migration
pnpm --filter web-vite migrate             # apply migrations
pnpm --filter web-vite seed:admins         # seed super-admins
```

## Media storage (Supabase Storage / S3)

`payload.config.ts` wires `@payloadcms/storage-s3` for the `media` collection,
**gated on env** — with the vars unset it's inert and Media keeps its previous
(local/static `/blog-media`) behavior, so nothing breaks until you opt in.

To enable:

1. In Supabase → **Storage**, create a **public** bucket, e.g. `cms-media`.
2. Supabase → Storage → **Settings → S3 Connection**: generate an **S3 access
   key** (access key id + secret).
3. Fill these in `apps/web/.env` and `apps/web-vite/.env` (and in Vercel for
   `apps/web`):

   ```
   S3_BUCKET=cms-media
   S3_ENDPOINT=https://npfjanxturvmjyevoyfo.supabase.co/storage/v1/s3
   S3_REGION=us-east-1
   S3_ACCESS_KEY_ID=...
   S3_SECRET_ACCESS_KEY=...
   ```

Once set, new admin uploads land in Supabase Storage. The blog detects
`S3_BUCKET` and serves Payload's media URL (`/payload-api/media/file/<name>`,
which proxies S3) instead of the static `/blog-media` rewrite.

**Existing media (one-time migration):** the legacy blog images live in
`apps/web/public/blog-media/`. After enabling S3, upload those files into the
`cms-media` bucket with the **same filenames** the `payload.media` rows
reference (so Payload can serve them). Until that's done, only newly-uploaded
media will resolve via S3; the static `/blog-media` copies remain for old posts
only while `S3_BUCKET` is unset.

## Blog editor and optional editorial workspace

Blog posts use one native Payload edit form with always-visible sections. The
unnamed groups are presentation-only: persisted field paths and REST payloads
stay unchanged, including `seo.*`, `meta.*`, relationships and Lexical content.
Payload still owns draft saves, publication, validation, versions and document
locking. Legacy SEO/cover fields remain editable for existing articles.

The unfinished `editorial-channels` and `editorial-queue` workspace is **not
registered by default**. Registering collections without their schema also
changes Payload's shared document-lock relationship, which can break every
existing collection's edit page (`editorial_channels_id does not exist`).

Only set `PAYLOAD_EDITORIAL_COLLECTIONS_READY=true` after a separately reviewed
migration has provisioned both collection tables, indexes/constraints and all
Payload-managed relationship columns, and an isolated-database test has passed.
The flag is an explicit readiness assertion, not a schema detector or migration
runner. Keep it unset on the existing production schema. Do not enable
`PAYLOAD_PUSH` in production. No migration is needed for the blog editor fix.

Regression tests (no database or production credentials required):

```bash
node --import tsx --test packages/cms/src/posts/*.test.ts
```

## Account-linked author profiles

A writer is the authenticated `admin-users` account, including the same account
returned by the Better Auth staff strategy. App user IDs are not CMS IDs. The
existing `authors.user` relationship is the only ownership link; profiles are
never claimed by matching an author name, slug or email.

- **My author profile** in the admin/account page opens or creates the writer's
  existing profile. The native Authors form retains name, slug, editorial title,
  bio, avatar selection, contact email, all social links and external profile URL.
  The avatar URL fallback remains synced/read-only; existing Media upload roles
  are unchanged. The editorial title does not change the staff permission role.
- New posts stamp `createdBy` from authentication and default their byline to
  that account's author. Admins/super-admins retain editorial credit overrides.
  Moderators may edit only their own profiles and posts, and cannot impersonate
  another byline or forge creator IDs.
- **Set me as author** explicitly replaces the native primary-author field on an
  existing post. Payload still owns autosave, Save Draft, Publish and locking.
  Ordinary edits do not change historical bylines or claim unlinked seed authors.
- Profile fields populate through the existing author relationship on every
  article. Contact email and the private staff-account link are not public REST
  fields. Profile links must use HTTP(S).

No new collection or unique index is required. Existing databases must apply the
author-history schema repair described below before author saves. Provisioning
and initial linking serialize on the existing staff-account row in the same Payload
Postgres transaction. Every nested Local API call receives that request. If an
account already has several historical profiles, the lowest author ID is reused;
no profiles or article relationships are deleted or backfilled. Established
account links cannot be transferred or removed, including by admins; change the
article byline for editorial reassignment instead. New duplicate
links are rejected through ordinary collection writes. Direct database writers
must not bypass these hooks. Database transactions must remain enabled.

Verification:

```bash
node --import tsx --test packages/cms/src/authors/*.test.ts packages/cms/src/posts/*.test.ts
# Requires an EMPTY disposable loopback Postgres database, never app credentials:
DVNT_AUTHOR_TEST_DATABASE_URL=postgresql://dvnt_author_fixture:...@127.0.0.1:5432/dvnt_author_fixture \
  node scripts/test-author-profiles-integration.cjs
```

### Real-account author picker and profile photos

Editors can now choose a real staff account directly in **Add a real account as
author**, even before it has an Authors record. The recorded creator is selected
when available; otherwise new articles prefer the signed-in writer. Search,
pagination and current profile photos help distinguish accounts. Opening or
searching the picker is read-only. **Add account as author** provisions/reuses that
account's author profile and appends it to the native byline without deleting
other credits. Save Draft/Publish still applies the change. The separate **Set me
as author** button is an explicit replacement. Moderators remain self-only;
admins and super-admins may assign other real staff accounts.

Historical articles are not silently attributed from guesses, names or seed
profiles. Created by is a private creation/audit link, not an automatic rewrite
of an old byline. Missing historical attribution needs an explicit selection.

Linked author photos resolve the current app profile image on read through the
existing staff email bridge. This is a read-only lookup with bounded database
waits; no account roles or profile records are mutated during reads. An explicit
removed app avatar clears the stale fallback; unavailable/ambiguous app identity
falls back to a safe cached CMS image. The picker batches its image lookups.
Private account/contact information is never returned by the choices endpoint.
An explicitly selected editorial Authors.avatar upload still overrides the app
photo on the public card; leave that upload empty to follow the app profile.

### Author history schema prerequisite

Payload enables author version history by default. The June 2026 migrations
added `user_id`, `avatar_url`, and `socials_onlyfans` only to `payload.authors`.
Existing databases also need
`20261019153500_repair_author_version_fields.sql` before profile saves work.
It adds the three nullable version columns and the account FK/index without
rewriting historical snapshots or disabling versioning. Apply through the normal
approved database migration process; deploying the application does not apply it.

The isolated author integration test now models this populated legacy schema,
checks failed saves roll back before migration, applies the checked-in repair
twice, and verifies full HTTP profile saves and version retrieval afterwards.
