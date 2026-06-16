// src/lib/posts.ts — blog data layer.
// Reads posts DIRECTLY from the Supabase `payload` schema (Payload's own tables)
// so the live blog works without a hosted Payload server. Media files are served
// as static assets from the blog's /public/blog-media (copied out of Payload).
// `BLOG_DATABASE_URL` is the Supabase pooler connection string. Resilient: if the
// DB is unset/unreachable the routes render empty instead of failing the build.
import { Pool } from 'pg'

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
  socials?: { instagram?: string; twitter?: string; tiktok?: string; website?: string }
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

// ── Supabase (payload schema) access ─────────────────────────────────────────
let pool: Pool | null = null
function db(): Pool | null {
  const url = process.env.BLOG_DATABASE_URL || process.env.DATABASE_URL
  if (!url) return null
  if (!pool) pool = new Pool({ connectionString: url, max: 3, ssl: { rejectUnauthorized: false } })
  return pool
}

async function q<T = any>(text: string, params: any[] = []): Promise<T[]> {
  const p = db()
  if (!p) return []
  try {
    return (await p.query(text, params)).rows as T[]
  } catch (e) {
    console.error('[posts] query failed:', (e as any)?.message)
    return []
  }
}

// Payload media URLs are `/api/media/file/<filename>`; the files are copied into
// the blog's /public/blog-media, so rewrite to that static (Vercel-served) path.
function fixMedia(url?: string | null): string | undefined {
  if (!url) return undefined
  const m = String(url).match(/\/api\/media\/file\/(.+)$/)
  return m ? `/blog-media/${m[1]}` : url
}
const sized = (u?: string | null) => (fixMedia(u) ? { url: fixMedia(u)! } : undefined)

const POST_COLS = `
  p.id, p.title, p.slug, p.excerpt, p.eyebrow, p.content, p.content_html,
  p.published_at, p.updated_at, p.hero_caption, p.hero_video_url,
  p.featured, p.editors_pick, p.trending, p.read_time,
  p.seo_title, p.seo_description, p.seo_canonical_url, p.seo_no_index,
  hm.id as hero_id, hm.url as hero_url, hm.alt as hero_alt,
  hm.width as hero_w, hm.height as hero_h,
  hm.sizes_card_url as hero_card, hm.sizes_thumbnail_url as hero_thumb, hm.sizes_og_url as hero_og
`

function rowToPost(r: any, authors: PostAuthor[], categories: PostCategory[]): Post {
  return {
    id: String(r.id),
    title: r.title,
    slug: r.slug,
    excerpt: r.excerpt ?? undefined,
    eyebrow: r.eyebrow ?? undefined,
    content: r.content ?? undefined,
    contentHtml: r.content_html ?? undefined,
    publishedAt: r.published_at ? new Date(r.published_at).toISOString() : undefined,
    updatedAt: r.updated_at ? new Date(r.updated_at).toISOString() : undefined,
    heroImage: r.hero_url
      ? {
          id: String(r.hero_id ?? ''),
          url: fixMedia(r.hero_url)!,
          alt: r.hero_alt ?? undefined,
          width: r.hero_w ?? undefined,
          height: r.hero_h ?? undefined,
          sizes: { card: sized(r.hero_card), thumbnail: sized(r.hero_thumb), og: sized(r.hero_og) },
        }
      : undefined,
    heroCaption: r.hero_caption ?? undefined,
    heroVideoUrl: r.hero_video_url ?? undefined,
    authors,
    categories,
    featured: !!r.featured,
    editorsPick: !!r.editors_pick,
    trending: !!r.trending,
    readTime: r.read_time != null ? Number(r.read_time) : undefined,
    seo: {
      title: r.seo_title ?? undefined,
      description: r.seo_description ?? undefined,
      canonicalUrl: r.seo_canonical_url ?? undefined,
      noIndex: !!r.seo_no_index,
    },
  }
}

// Core loader: posts (+ hero media) matching `whereSql`, then their authors +
// categories via posts_rels in one batched query. Newest first.
async function loadPosts(whereSql: string, params: any[], limit?: number, offset?: number): Promise<Post[]> {
  const lim = limit != null ? `limit ${Math.max(0, Math.trunc(limit))}` : ''
  const off = offset != null ? `offset ${Math.max(0, Math.trunc(offset))}` : ''
  const rows = await q(
    `select ${POST_COLS}
       from payload.posts p
       left join payload.media hm on hm.id = p.hero_image_id
      where ${whereSql}
      order by p.published_at desc nulls last ${lim} ${off}`,
    params,
  )
  if (!rows.length) return []
  const ids = rows.map((r) => r.id)
  const rels = await q(
    `select r.parent_id, r.path, r."order",
            a.id as a_id, a.name as a_name, a.slug as a_slug, a.role as a_role, a.bio as a_bio,
            a.socials_instagram, a.socials_twitter, a.socials_tiktok, a.socials_website, a.profile_url,
            av.url as a_avatar_url, av.sizes_thumbnail_url as a_avatar_thumb,
            c.id as c_id, c.title as c_title, c.slug as c_slug, c.accent_color, c.description
       from payload.posts_rels r
       left join payload.authors a on a.id = r.authors_id
       left join payload.media av on av.id = a.avatar_id
       left join payload.categories c on c.id = r.categories_id
      where r.parent_id = any($1) and r.path in ('authors', 'categories')
      order by r.parent_id, r."order" nulls last`,
    [ids],
  )
  const authorsByPost = new Map<number, PostAuthor[]>()
  const catsByPost = new Map<number, PostCategory[]>()
  for (const rel of rels) {
    if (rel.path === 'authors' && rel.a_id) {
      const arr = authorsByPost.get(rel.parent_id) ?? []
      arr.push({
        id: String(rel.a_id),
        name: rel.a_name,
        slug: rel.a_slug,
        role: rel.a_role ?? undefined,
        bio: rel.a_bio ?? undefined,
        avatar: rel.a_avatar_url
          ? { id: '', url: fixMedia(rel.a_avatar_url)!, sizes: { thumbnail: sized(rel.a_avatar_thumb) } }
          : undefined,
        socials: {
          instagram: rel.socials_instagram ?? undefined,
          twitter: rel.socials_twitter ?? undefined,
          tiktok: rel.socials_tiktok ?? undefined,
          website: rel.socials_website ?? undefined,
        },
        profileUrl: rel.profile_url ?? undefined,
      })
      authorsByPost.set(rel.parent_id, arr)
    } else if (rel.path === 'categories' && rel.c_id) {
      const arr = catsByPost.get(rel.parent_id) ?? []
      arr.push({
        id: String(rel.c_id),
        title: rel.c_title,
        slug: rel.c_slug,
        accentColor: rel.accent_color ?? undefined,
        description: rel.description ?? undefined,
      })
      catsByPost.set(rel.parent_id, arr)
    }
  }
  return rows.map((r) => rowToPost(r, authorsByPost.get(r.id) ?? [], catsByPost.get(r.id) ?? []))
}

const PUBLISHED = `p._status = 'published'`
const inCategory = (n: number) =>
  `exists (select 1 from payload.posts_rels rr join payload.categories cc on cc.id = rr.categories_id
             where rr.parent_id = p.id and rr.path = 'categories' and cc.slug = $${n})`

export async function getPublishedPosts(limit = 100, category?: string): Promise<Post[]> {
  if (category) return loadPosts(`${PUBLISHED} and ${inCategory(1)}`, [category], limit)
  return loadPosts(PUBLISHED, [], limit)
}

export async function getPostsPage(
  opts: { page?: number; limit?: number; category?: string } = {},
): Promise<{ docs: Post[]; totalPages: number; page: number }> {
  const { page = 1, limit = 12, category } = opts
  const where = category ? `${PUBLISHED} and ${inCategory(1)}` : PUBLISHED
  const params = category ? [category] : []
  const docs = await loadPosts(where, params, limit, (page - 1) * limit)
  const countRows = await q<{ n: number }>(`select count(*)::int n from payload.posts p where ${where}`, params)
  const total = countRows[0]?.n ?? docs.length
  return { docs, totalPages: Math.max(1, Math.ceil(total / limit)), page }
}

export async function getFeaturedPost(): Promise<Post | null> {
  const r = await loadPosts(`${PUBLISHED} and p.featured = true`, [], 1)
  return r[0] ?? null
}

export async function getEditorsPicks(limit = 4): Promise<Post[]> {
  return loadPosts(`${PUBLISHED} and p.editors_pick = true`, [], limit)
}

export async function getTrending(limit = 5): Promise<Post[]> {
  return loadPosts(`${PUBLISHED} and p.trending = true`, [], limit)
}

export async function getCategories(): Promise<PostCategory[]> {
  const rows = await q(
    `select id, title, slug, accent_color, description from payload.categories order by "order" nulls last limit 50`,
  )
  return rows.map((c) => ({
    id: String(c.id),
    title: c.title,
    slug: c.slug,
    accentColor: c.accent_color ?? undefined,
    description: c.description ?? undefined,
  }))
}

export async function getLatestPosts(limit = 4, excludeSlug?: string): Promise<Post[]> {
  const rows = await loadPosts(PUBLISHED, [], limit + 1)
  return excludeSlug ? rows.filter((p) => p.slug !== excludeSlug).slice(0, limit) : rows.slice(0, limit)
}

export async function getAllSlugs(): Promise<string[]> {
  const rows = await q<{ slug: string }>(`select p.slug from payload.posts p where ${PUBLISHED} limit 1000`)
  return rows.map((r) => r.slug).filter(Boolean)
}

export async function getPostBySlug(slug: string, _draft = false): Promise<Post | null> {
  const r = await loadPosts(`p.slug = $1 and ${PUBLISHED}`, [slug], 1)
  return r[0] ?? null
}
