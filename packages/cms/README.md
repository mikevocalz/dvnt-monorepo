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
