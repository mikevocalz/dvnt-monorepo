// src/blog/api.ts — typed public REST client for the DVNT blog.
// Same-origin Payload REST API (/api/…). Runs server-side in TanStack Start
// loaders and client-side in the browser.
import { addBreadcrumb, capturePostError } from './sentry'

const BASE = typeof window !== 'undefined'
  ? ''
  : (process.env.SERVER_URL ?? 'http://localhost:3000')

async function apiFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
  })
  if (!res.ok) {
    const err = new Error(`Payload ${res.status} ${res.statusText} — ${path}`)
    capturePostError(err, {
      operation: 'apiFetch',
      route: path,
      payloadCollection: path.split('/')[1],
    })
    throw err
  }
  return res.json()
}

// ─── Shared types ─────────────────────────────────────────────────────────

export type BlogMedia = {
  id: number
  url: string
  alt: string
  width?: number
  height?: number
  creditText?: string
  sizes?: {
    thumbnail?: { url: string }
    card?: { url: string }
    og?: { url: string }
  }
}

export type BlogAuthor = {
  id: number
  name: string
  slug: string
  role?: string
  bio?: string
  avatar?: BlogMedia
  socials?: {
    instagram?: string
    twitter?: string
    tiktok?: string
    website?: string
  }
  profileUrl?: string
}

export type BlogContributor = {
  id?: string
  author: BlogAuthor
  role: string
}

export type BlogCategory = {
  id: number
  title: string
  slug: string
  description?: string
  accentColor?: string
  featuredImage?: BlogMedia
  order?: number
}

export type BlogPostCard = {
  id: number
  title: string
  slug: string
  excerpt?: string
  eyebrow?: string
  heroImage?: BlogMedia
  heroVideoUrl?: string
  authors?: BlogAuthor[]
  contributors?: BlogContributor[]
  categories?: BlogCategory[]
  tags?: { tag: string; id?: string }[]
  featured?: boolean
  editorsPick?: boolean
  trending?: boolean
  readTime?: number
  publishedAt?: string
  updatedAt?: string
  _status?: string
}

export type BlogPost = BlogPostCard & {
  contentHtml?: string
  heroCaption?: string
  relatedPosts?: BlogPostCard[]
  seo?: {
    title?: string
    description?: string
    ogImage?: BlogMedia
    canonicalUrl?: string
    noIndex?: boolean
  }
}

type Paginated<T> = {
  docs: T[]
  totalDocs: number
  totalPages: number
  page: number
  limit: number
}

const PUBLISHED = 'where[_status][equals]=published'
const DEPTH = 'depth=2'

// ─── Queries ──────────────────────────────────────────────────────────────

export async function fetchPostsIndex({
  page = 1,
  limit = 16,
  category,
}: { page?: number; limit?: number; category?: string } = {}): Promise<Paginated<BlogPostCard>> {
  addBreadcrumb('post.fetch.started', 'Fetching posts index', { page, limit })
  const cat = category ? `&where[categories.slug][equals]=${encodeURIComponent(category)}` : ''
  const data = await apiFetch<Paginated<BlogPostCard>>(
    `/posts?${PUBLISHED}&sort=-publishedAt&page=${page}&limit=${limit}&${DEPTH}${cat}`,
  )
  addBreadcrumb('post.fetch.succeeded', 'Posts index loaded', { count: data.docs.length })
  return data
}

export async function fetchFeaturedPost(): Promise<BlogPostCard | null> {
  const d = await apiFetch<Paginated<BlogPostCard>>(
    `/posts?${PUBLISHED}&where[featured][equals]=true&sort=-publishedAt&limit=1&${DEPTH}`,
  )
  return d.docs[0] ?? null
}

export async function fetchEditorsPicks(limit = 4): Promise<BlogPostCard[]> {
  const d = await apiFetch<Paginated<BlogPostCard>>(
    `/posts?${PUBLISHED}&where[editorsPick][equals]=true&sort=-publishedAt&limit=${limit}&${DEPTH}`,
  )
  return d.docs
}

export async function fetchTrending(limit = 6): Promise<BlogPostCard[]> {
  const d = await apiFetch<Paginated<BlogPostCard>>(
    `/posts?${PUBLISHED}&where[trending][equals]=true&sort=-publishedAt&limit=${limit}&${DEPTH}`,
  )
  return d.docs
}

export async function fetchPostBySlug(
  slug: string,
  preview = false,
): Promise<BlogPost | null> {
  addBreadcrumb('post.fetch.started', `Fetching post: ${slug}`, { slug })
  try {
    const statusFilter = preview ? '' : `&${PUBLISHED}`
    const d = await apiFetch<Paginated<BlogPost>>(
      `/posts?where[slug][equals]=${encodeURIComponent(slug)}${statusFilter}&limit=1&${DEPTH}`,
    )
    const post = d.docs[0] ?? null
    if (post) addBreadcrumb('post.fetch.succeeded', `Post loaded: ${slug}`, { slug })
    return post
  } catch (err) {
    capturePostError(err, { operation: 'fetchPostBySlug', slug, previewMode: preview })
    return null
  }
}

export async function fetchLatestPosts(
  limit = 8,
  excludeSlug?: string,
): Promise<BlogPostCard[]> {
  const d = await apiFetch<Paginated<BlogPostCard>>(
    `/posts?${PUBLISHED}&sort=-publishedAt&limit=${limit}&${DEPTH}`,
  )
  return excludeSlug ? d.docs.filter((p) => p.slug !== excludeSlug) : d.docs
}

export async function fetchCategories(): Promise<BlogCategory[]> {
  const d = await apiFetch<Paginated<BlogCategory>>('/categories?sort=order&limit=50')
  return d.docs
}

// ─── Utilities ────────────────────────────────────────────────────────────

export function mediaUrl(
  media: BlogMedia | undefined,
  size: 'thumbnail' | 'card' | 'og' | 'full' = 'full',
): string {
  if (!media) return ''
  if (size !== 'full' && media.sizes?.[size]?.url) return media.sizes[size]!.url
  return media.url
}

export function formatByline(authors: BlogAuthor[]): string {
  if (!authors?.length) return ''
  if (authors.length === 1) return `By ${authors[0].name}`
  const names = authors.map((a) => a.name)
  return `By ${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

export function formatDate(iso: string | undefined): string {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric',
  })
}

export function formatDateShort(iso: string | undefined): string {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  })
}
