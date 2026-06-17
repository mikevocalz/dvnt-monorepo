// src/payload.config.ts
// Payload v4 (TanStack Start adapter) on the Postgres adapter, pointed at the
// existing DVNT Supabase database. Every Payload collection uses an explicit
// dbName and lives in a dedicated `payload` schema so it never collides with
// the app's `public` tables (profiles, events, …). `push: false` means schema
// changes go through reviewed migrations (`pnpm migrate`), never auto-sync.
import { postgresAdapter } from '@payloadcms/db-postgres'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import { s3Storage } from '@payloadcms/storage-s3'
import sharp from 'sharp'
import path from 'path'
import { buildConfig, type Plugin } from 'payload'
import { fileURLToPath } from 'url'

import { AdminUsers } from './collections/AdminUsers'
import { Members } from './collections/Members'
import { Reports } from './collections/Reports'
import { Events } from './collections/Events'
import { Tickets } from './collections/Tickets'
import { BanList } from './collections/BanList'
import { ModerationActions } from './collections/ModerationActions'
import { Posts } from './collections/Posts'
import { Categories } from './collections/Categories'
import { Authors } from './collections/Authors'
import { Media } from './collections/Media'
import { Comments } from './collections/Comments'
import { appMembersEndpoint, appEventsEndpoint, appEventEndpoint, appEventUpdateEndpoint, appStatsEndpoint, appPromoteEndpoint, appSyncEndpoint, appVerifyEndpoint } from './endpoints/appData'
import { getServerSideURL } from './utilities/getURL'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)

// Media storage: when S3 creds are present, store uploads in Supabase Storage
// (S3-compatible). INERT until configured — with the env unset the plugin list
// is empty and Media stays on the previous (local/static) behavior, so the
// build and existing /blog-media assets are unaffected. Supabase needs
// forcePathStyle + the /storage/v1/s3 endpoint. See packages/cms/README.
const s3Enabled = Boolean(
  process.env.S3_BUCKET &&
    process.env.S3_ACCESS_KEY_ID &&
    process.env.S3_SECRET_ACCESS_KEY,
)

const storagePlugins: Plugin[] = s3Enabled
  ? [
      s3Storage({
        collections: { media: true },
        bucket: process.env.S3_BUCKET as string,
        acl: 'public-read',
        config: {
          endpoint: process.env.S3_ENDPOINT, // https://<ref>.supabase.co/storage/v1/s3
          region: process.env.S3_REGION || 'us-east-1',
          forcePathStyle: true, // required for Supabase Storage's S3 gateway
          credentials: {
            accessKeyId: process.env.S3_ACCESS_KEY_ID as string,
            secretAccessKey: process.env.S3_SECRET_ACCESS_KEY as string,
          },
        },
        // storage adapters are valid plugins at runtime; the package's
        // StorageAdapter type just doesn't line up with payload's Plugin type.
      }) as unknown as Plugin,
    ]
  : []

export default buildConfig({
  // The Payload admin login collection (separate from DVNT app members).
  admin: {
    user: AdminUsers.slug,
    // Force the dark palette as the base for the DVNT deviant theme.
    theme: 'dark',
    // Brand the CMS as DVNT so it reads as the same product as the console.
    components: {
      graphics: {
        Logo: '@dvnt/cms/components/Logo',
        Icon: '@dvnt/cms/components/Icon',
      },
      beforeLogin: ['@dvnt/cms/components/BeforeLogin'],
      beforeDashboard: ['@dvnt/cms/components/SyncFromApp'],
      afterNavLinks: ['@dvnt/cms/components/BackToConsole', '@dvnt/cms/components/KeepNavInteractive'],
    },
    importMap: {
      // Admin component paths above are package specifiers (@dvnt/cms/components/*)
      // so they resolve identically in apps/web (runtime) and web-vite (CLI).
      baseDir: path.resolve(dirname),
    },
    livePreview: {
      breakpoints: [
        { label: 'Mobile', name: 'mobile', width: 375, height: 667 },
        { label: 'Tablet', name: 'tablet', width: 768, height: 1024 },
        { label: 'Desktop', name: 'desktop', width: 1440, height: 900 },
      ],
    },
  },

  // Payload's REST/GraphQL live under /payload-api (NOT /api): apps/web already
  // owns /api/* (auth proxy, comments, newsletter, preview), and a Payload
  // `comments` collection at /api/comments would collide with the app's own
  // /api/comments route. Admin stays at /admin. The (payload)/payload-api/*
  // route folders must match this base.
  routes: {
    api: '/payload-api',
  },

  collections: [AdminUsers, Members, Reports, Events, Tickets, BanList, ModerationActions, Posts, Categories, Authors, Media, Comments],

  // Read-only windows onto the live app DB (real members/events). See appData.ts.
  endpoints: [appMembersEndpoint, appEventsEndpoint, appEventEndpoint, appEventUpdateEndpoint, appStatsEndpoint, appPromoteEndpoint, appSyncEndpoint, appVerifyEndpoint],

  // Supabase Storage for Media uploads (inert until S3 env is set — see above).
  plugins: storagePlugins,

  editor: lexicalEditor(),

  db: postgresAdapter({
    pool: {
      // Supabase pooled connection string (use the 6543 pooler for serverless).
      connectionString: process.env.DATABASE_URI,
    },
    // CRITICAL: keep Payload from dropping/owning the existing app schema.
    // Changes go through migrations you review, not auto-sync. Defaults OFF
    // (prod-safe); set PAYLOAD_PUSH=true only for local dev against a throwaway
    // Postgres to auto-create the `payload` schema without writing migrations.
    push: process.env.PAYLOAD_PUSH === 'true',
    // Map Payload's own tables into a dedicated schema so they never collide
    // with the `public` schema the DVNT app uses.
    schemaName: 'payload',
  }),

  cors: [getServerSideURL(), process.env.FRONTEND_ORIGIN ?? 'http://localhost:5173'].filter(Boolean),
  csrf: [getServerSideURL(), process.env.FRONTEND_ORIGIN ?? 'http://localhost:5173'].filter(Boolean),

  secret: process.env.PAYLOAD_SECRET || '',
  // sharp's exported type drifts from Payload v4's SharpDependency; the runtime
  // shape is correct.
  sharp: sharp as unknown as Parameters<typeof buildConfig>[0]['sharp'],
  typescript: {
    outputFile: path.resolve(dirname, 'payload-types.ts'),
  },
})
