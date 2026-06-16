// src/lib/posts.ts — blog data layer.
// Reads the Payload REST API (the web-vite admin app). Public reads return only
// published docs; draft reads (live preview) pass `?draft=true`. Resilient to a
// down/unset Payload so the Next build never fails on the blog routes.
const PAYLOAD_URL = process.env.PAYLOAD_URL || process.env.NEXT_PUBLIC_PAYLOAD_URL || ''

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

export function mediaUrl(media: PostMedia | undefined, size: 'thumbnail' | 'card' | 'og' | 'full' = 'full'): string {
  if (!media) return ''
  const url = size !== 'full' && media.sizes?.[size]?.url ? media.sizes[size]!.url : media.url
  return url?.startsWith('http') ? url : `${PAYLOAD_URL}${url}`
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

// Payload returns relative media URLs (/api/media/file/…) which would resolve
// against the blog origin, not Payload. Absolutize them against PAYLOAD_URL.
function absolutize<T>(node: T): T {
  if (!node || typeof node !== 'object') return node
  for (const [k, v] of Object.entries(node as any)) {
    if (k === 'url' && typeof v === 'string' && v.startsWith('/')) (node as any)[k] = `${PAYLOAD_URL}${v}`
    else if (v && typeof v === 'object') absolutize(v)
  }
  return node
}

async function api<T>(path: string, opts?: { draft?: boolean }): Promise<T | null> {
  if (!PAYLOAD_URL) return null
  try {
    const url = `${PAYLOAD_URL}/api${path}`
    const res = await fetch(url, {
      // Drafts must bypass the CDN cache; published can ISR.
      cache: opts?.draft ? 'no-store' : 'force-cache',
      next: opts?.draft ? undefined : { revalidate: 60 },
      headers: process.env.PAYLOAD_API_KEY
        ? { Authorization: `admin-users API-Key ${process.env.PAYLOAD_API_KEY}` }
        : undefined,
    })
    if (!res.ok) return null
    return absolutize((await res.json()) as T)
  } catch {
    return null
  }
}

type Paginated<T> = { docs: T[] }

export async function getPublishedPosts(limit = 100, category?: string): Promise<Post[]> {
  const cat = category ? `&where[categories.slug][equals]=${encodeURIComponent(category)}` : ''
  const data = await api<Paginated<Post>>(
    `/posts?where[_status][equals]=published&depth=2&sort=-publishedAt&limit=${limit}${cat}`,
  )
  return data?.docs ?? []
}

// Paginated index for the magazine grid (Payload returns totalPages/page).
export async function getPostsPage(
  opts: { page?: number; limit?: number; category?: string } = {},
): Promise<{ docs: Post[]; totalPages: number; page: number }> {
  const { page = 1, limit = 12, category } = opts
  const cat = category ? `&where[categories.slug][equals]=${encodeURIComponent(category)}` : ''
  const data = await api<{ docs: Post[]; totalPages: number; page: number }>(
    `/posts?where[_status][equals]=published&depth=2&sort=-publishedAt&page=${page}&limit=${limit}${cat}`,
  )
  return { docs: data?.docs ?? [], totalPages: data?.totalPages ?? 1, page: data?.page ?? page }
}

export async function getFeaturedPost(): Promise<Post | null> {
  const data = await api<Paginated<Post>>(
    '/posts?where[_status][equals]=published&where[featured][equals]=true&sort=-publishedAt&depth=2&limit=1',
  )
  return data?.docs?.[0] ?? null
}

export async function getEditorsPicks(limit = 4): Promise<Post[]> {
  const data = await api<Paginated<Post>>(
    `/posts?where[_status][equals]=published&where[editorsPick][equals]=true&sort=-publishedAt&depth=2&limit=${limit}`,
  )
  return data?.docs ?? []
}

export async function getTrending(limit = 5): Promise<Post[]> {
  const data = await api<Paginated<Post>>(
    `/posts?where[_status][equals]=published&where[trending][equals]=true&sort=-publishedAt&depth=2&limit=${limit}`,
  )
  return data?.docs ?? []
}

export async function getCategories(): Promise<PostCategory[]> {
  const data = await api<Paginated<PostCategory>>('/categories?sort=order&limit=50')
  return data?.docs ?? []
}

export async function getLatestPosts(limit = 4, excludeSlug?: string): Promise<Post[]> {
  const data = await api<Paginated<Post>>(
    `/posts?where[_status][equals]=published&sort=-publishedAt&depth=2&limit=${limit + 1}`,
  )
  const docs = data?.docs ?? []
  return excludeSlug ? docs.filter((p) => p.slug !== excludeSlug).slice(0, limit) : docs.slice(0, limit)
}

export async function getAllSlugs(): Promise<string[]> {
  const data = await api<Paginated<Pick<Post, 'slug'>>>(
    '/posts?where[_status][equals]=published&depth=0&limit=1000',
  )
  return (data?.docs ?? []).map((d) => d.slug).filter(Boolean)
}

export async function getPostBySlug(slug: string, draft = false): Promise<Post | null> {
  const q = `/posts?where[slug][equals]=${encodeURIComponent(slug)}&depth=2&limit=1${draft ? '&draft=true' : ''}`
  const data = await api<Paginated<Post>>(q, { draft })
  return data?.docs?.[0] ?? null
}
