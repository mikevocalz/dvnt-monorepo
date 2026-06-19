// src/lib/posts.ts — blog data layer.
// Reads posts via Payload's LOCAL API (Payload now runs in-process in this Next
// app — see src/payload.config.ts + app/(payload)). No HTTP, no raw SQL: the
// same getPayload() instance that powers /admin serves the public blog.
//
// Media: Payload returns upload URLs under /payload-api/media/file/<name>; the
// files are also copied into /public/blog-media (Vercel-served static), so we
// rewrite to that static path — matching the previous production behavior.
//
// Resilient: every query is wrapped so a DB hiccup (or build with no DATABASE_URI)
// renders empty instead of failing the build, exactly as the old pg layer did.
import { getPayload, type Payload } from 'payload'
import config from '@payload-config'

export type PostMedia = {
  id: string
  url: string
  alt?: string
  width?: number
  height?: number
  sizes?: { thumbnail?: { url: string }; card?: { url: string }; og?: { url: string } }
}

export type PostAuthor = {
  id: string
  name: string
  slug: string
  role?: string
  bio?: string
  avatar?: PostMedia
  socials?: { instagram?: string; twitter?: string; tiktok?: string; onlyfans?: string; website?: string }
  profileUrl?: string
}

export type PostContributor = {
  id?: string
  author: PostAuthor
  role: string
}

export type PostCategory = {
  id: string
  title: string
  slug: string
  accentColor?: string
  description?: string
}

export type Post = {
  id: string
  title: string
  slug: string
  excerpt?: string
  eyebrow?: string
  content?: unknown
  contentHtml?: string
  publishedAt?: string
  updatedAt?: string
  heroImage?: PostMedia
  heroCaption?: string
  heroVideoUrl?: string
  coverImage?: { url?: string; alt?: string }
  authors?: PostAuthor[]
  contributors?: PostContributor[]
  categories?: PostCategory[]
  tags?: { tag: string }[]
  featured?: boolean
  editorsPick?: boolean
  trending?: boolean
  readTime?: number
  relatedPosts?: Post[]
  meta?: { title?: string; description?: string; image?: { url?: string } }
  seo?: {
    title?: string
    description?: string
    ogImage?: PostMedia
    canonicalUrl?: string
    noIndex?: boolean
  }
}

// ── helpers (unchanged surface) ──────────────────────────────────────────────
export function mediaUrl(media: PostMedia | undefined, size: 'thumbnail' | 'card' | 'og' | 'full' = 'full'): string {
  if (!media) return ''
  const url = size !== 'full' && media.sizes?.[size]?.url ? media.sizes[size]!.url : media.url
  return url || ''
}

export function formatByline(authors: PostAuthor[]): string {
  if (!authors?.length) return ''
  if (authors.length === 1) return `By ${authors[0].name}`
  return `By ${authors.slice(0, -1).map((a) => a.name).join(', ')} and ${authors[authors.length - 1].name}`
}

export function formatDate(iso: string | undefined): string {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}

export function formatDateShort(iso: string | undefined): string {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

// ── Payload Local API client (cached singleton) ──────────────────────────────
let _payload: Promise<Payload> | null = null
function client(): Promise<Payload> {
  if (!_payload) _payload = getPayload({ config })
  return _payload
}

// Media URL strategy:
//  - Absolute URLs (direct Supabase public URLs) always pass through.
//  - When Media lives in Supabase Storage (S3_BUCKET set — see
//    packages/cms/payload.config.ts s3Storage), serve Payload's own URL
//    (`/payload-api/media/file/<name>`, which proxies S3) untouched.
//  - Otherwise (legacy), rewrite to the static /public/blog-media assets.
// Mirror packages/cms s3Storage gating EXACTLY (bucket + both keys) so the blog
// only switches to Payload/S3 URLs once the storage plugin is actually active —
// pre-filling S3_BUCKET alone must not flip this.
const MEDIA_ON_S3 = Boolean(
  process.env.S3_BUCKET && process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY,
)
function fixMedia(url?: string | null): string | undefined {
  if (!url) return undefined
  const u = String(url)
  if (/^https?:\/\//.test(u)) return u
  if (MEDIA_ON_S3) return u
  const m = u.match(/\/(?:payload-)?api\/media\/file\/(.+)$/)
  return m ? `/blog-media/${m[1]}` : u
}
const sized = (u?: string | null) => (fixMedia(u) ? { url: fixMedia(u)! } : undefined)

// ── Payload doc → blog type mappers ──────────────────────────────────────────
function mapMedia(m: any): PostMedia | undefined {
  if (!m || typeof m !== 'object') return undefined
  return {
    id: String(m.id ?? ''),
    url: fixMedia(m.url) ?? '',
    alt: m.alt ?? undefined,
    width: m.width ?? undefined,
    height: m.height ?? undefined,
    sizes: {
      thumbnail: sized(m.sizes?.thumbnail?.url),
      card: sized(m.sizes?.card?.url),
      og: sized(m.sizes?.og?.url),
    },
  }
}

function mapAuthor(a: any): PostAuthor | null {
  if (!a || typeof a !== 'object') return null
  // Avatar: an explicit media upload overrides; otherwise use the avatar synced
  // from the linked user (admin-users.avatarUrl → authors.avatarUrl).
  const avatar =
    mapMedia(a.avatar) ??
    (a.avatarUrl ? { id: '', url: fixMedia(a.avatarUrl) ?? '' } : undefined)
  return {
    id: String(a.id ?? ''),
    name: a.name,
    slug: a.slug,
    role: a.role ?? undefined,
    bio: a.bio ?? undefined,
    avatar,
    socials: {
      instagram: a.socials?.instagram ?? undefined,
      twitter: a.socials?.twitter ?? undefined,
      tiktok: a.socials?.tiktok ?? undefined,
      onlyfans: a.socials?.onlyfans ?? undefined,
      website: a.socials?.website ?? undefined,
    },
    profileUrl: a.profileUrl ?? undefined,
  }
}

function mapCategory(c: any): PostCategory | null {
  if (!c || typeof c !== 'object') return null
  return {
    id: String(c.id ?? ''),
    title: c.title,
    slug: c.slug,
    accentColor: c.accentColor ?? undefined,
    description: c.description ?? undefined,
  }
}

function docToPost(d: any): Post {
  return {
    id: String(d.id),
    title: d.title,
    slug: d.slug,
    excerpt: d.excerpt ?? undefined,
    eyebrow: d.eyebrow ?? undefined,
    content: d.content ?? undefined,
    publishedAt: d.publishedAt ? new Date(d.publishedAt).toISOString() : undefined,
    updatedAt: d.updatedAt ? new Date(d.updatedAt).toISOString() : undefined,
    heroImage: mapMedia(d.heroImage),
    heroCaption: d.heroCaption ?? undefined,
    heroVideoUrl: d.heroVideoUrl ?? undefined,
    authors: Array.isArray(d.authors) ? (d.authors.map(mapAuthor).filter(Boolean) as PostAuthor[]) : [],
    categories: Array.isArray(d.categories) ? (d.categories.map(mapCategory).filter(Boolean) as PostCategory[]) : [],
    tags: Array.isArray(d.tags) ? d.tags : undefined,
    featured: !!d.featured,
    editorsPick: !!d.editorsPick,
    trending: !!d.trending,
    readTime: d.readTime != null ? Number(d.readTime) : undefined,
    seo: d.seo
      ? {
          title: d.seo.title ?? undefined,
          description: d.seo.description ?? undefined,
          ogImage: mapMedia(d.seo.ogImage),
          canonicalUrl: d.seo.canonicalUrl ?? undefined,
          noIndex: !!d.seo.noIndex,
        }
      : undefined,
  }
}

// ── Query core ───────────────────────────────────────────────────────────────
const PUBLISHED = { _status: { equals: 'published' } }
const inCategory = (slug: string) => ({ 'categories.slug': { equals: slug } })

async function findPosts(where: any, opts: { limit?: number; page?: number } = {}): Promise<Post[]> {
  try {
    const payload = await client()
    const res = await payload.find({
      collection: 'posts',
      where,
      depth: 2,
      limit: opts.limit ?? 100,
      page: opts.page,
      sort: '-publishedAt',
      overrideAccess: true,
    })
    return res.docs.map(docToPost)
  } catch (e) {
    console.error('[posts] find failed:', (e as any)?.message)
    return []
  }
}

// ── public API (unchanged surface) ───────────────────────────────────────────
export async function getPublishedPosts(limit = 100, category?: string): Promise<Post[]> {
  const where = category ? { and: [PUBLISHED, inCategory(category)] } : PUBLISHED
  return findPosts(where, { limit })
}

export async function getPostsPage(
  opts: { page?: number; limit?: number; category?: string } = {},
): Promise<{ docs: Post[]; totalPages: number; page: number }> {
  const { page = 1, limit = 12, category } = opts
  const where = category ? { and: [PUBLISHED, inCategory(category)] } : PUBLISHED
  try {
    const payload = await client()
    const res = await payload.find({
      collection: 'posts',
      where,
      depth: 2,
      limit,
      page,
      sort: '-publishedAt',
      overrideAccess: true,
    })
    return { docs: res.docs.map(docToPost), totalPages: res.totalPages, page: res.page ?? page }
  } catch (e) {
    console.error('[posts] page query failed:', (e as any)?.message)
    return { docs: [], totalPages: 1, page }
  }
}

export async function getFeaturedPost(): Promise<Post | null> {
  const r = await findPosts({ and: [PUBLISHED, { featured: { equals: true } }] }, { limit: 1 })
  return r[0] ?? null
}

export async function getEditorsPicks(limit = 4): Promise<Post[]> {
  return findPosts({ and: [PUBLISHED, { editorsPick: { equals: true } }] }, { limit })
}

export async function getTrending(limit = 5): Promise<Post[]> {
  return findPosts({ and: [PUBLISHED, { trending: { equals: true } }] }, { limit })
}

export async function getCategories(): Promise<PostCategory[]> {
  try {
    const payload = await client()
    const res = await payload.find({ collection: 'categories', limit: 50, sort: 'title', overrideAccess: true })
    return res.docs.map((c) => mapCategory(c)).filter(Boolean) as PostCategory[]
  } catch (e) {
    console.error('[posts] categories failed:', (e as any)?.message)
    return []
  }
}

export async function getLatestPosts(limit = 4, excludeSlug?: string): Promise<Post[]> {
  const rows = await findPosts(PUBLISHED, { limit: limit + 1 })
  return excludeSlug ? rows.filter((p) => p.slug !== excludeSlug).slice(0, limit) : rows.slice(0, limit)
}

export async function getAllSlugs(): Promise<string[]> {
  try {
    const payload = await client()
    const res = await payload.find({
      collection: 'posts',
      where: PUBLISHED,
      depth: 0,
      limit: 1000,
      pagination: false,
      overrideAccess: true,
    })
    return res.docs.map((d: any) => d.slug).filter(Boolean)
  } catch (e) {
    console.error('[posts] slugs failed:', (e as any)?.message)
    return []
  }
}

export async function getPostBySlug(slug: string, _draft = false): Promise<Post | null> {
  const r = await findPosts({ and: [PUBLISHED, { slug: { equals: slug } }] }, { limit: 1 })
  return r[0] ?? null
}
