// Blog data layer (NATIVE). The blog itself is a Payload-backed Next app served
// on the web (blog.dvntapp.live / dvntapp.live /posts). Native can't use
// Payload's in-process Local API, so this is a thin REST client over Payload's
// public REST API (mounted at `/payload-api`, see packages/cms payload.config).
//
// Posts read access is public-but-published-only (packages/cms Posts.ts), and
// CORS is a browser-only concern — native fetch reaches it directly.

// Origin that serves the Payload app. Overridable for staging/preview builds.
export const BLOG_ORIGIN = (
  process.env.EXPO_PUBLIC_BLOG_URL ?? "https://dvntapp.live"
).replace(/\/$/, "");

const API = `${BLOG_ORIGIN}/payload-api`;

// ── Types (a native subset of apps/web/src/lib/posts.ts) ─────────────────────
export type BlogMedia = {
  id: string;
  url: string;
  alt?: string;
  width?: number;
  height?: number;
  sizes?: { thumbnail?: string; card?: string; og?: string };
};

export type BlogAuthor = {
  id: string;
  name: string;
  slug?: string;
  role?: string;
  bio?: string;
  avatar?: BlogMedia;
};

export type BlogCategory = {
  id: string;
  title: string;
  slug: string;
  accentColor?: string;
};

export type BlogPost = {
  id: string;
  title: string;
  slug: string;
  excerpt?: string;
  eyebrow?: string;
  content?: unknown; // Lexical editor state — rendered by BlogContent
  publishedAt?: string;
  heroImage?: BlogMedia;
  heroCaption?: string;
  authors: BlogAuthor[];
  categories: BlogCategory[];
  tags?: { tag: string }[];
  featured?: boolean;
  editorsPick?: boolean;
  trending?: boolean;
  readTime?: number;
};

// ── Media URL handling ───────────────────────────────────────────────────────
// Payload returns either absolute URLs (Supabase/S3) or paths relative to the
// blog origin (e.g. /payload-api/media/file/<name>). Absolute the relatives.
function absUrl(url?: string | null): string | undefined {
  if (!url) return undefined;
  const u = String(url);
  if (/^https?:\/\//.test(u)) return u;
  return `${BLOG_ORIGIN}${u.startsWith("/") ? "" : "/"}${u}`;
}

/** Pick the best available size for a target slot, falling back to full. */
export function blogMediaUrl(
  media: BlogMedia | undefined,
  size: "thumbnail" | "card" | "og" | "full" = "full",
): string {
  if (!media) return "";
  if (size !== "full" && media.sizes?.[size]) return media.sizes[size]!;
  return media.url || "";
}

export function blogByline(authors: BlogAuthor[]): string {
  if (!authors?.length) return "";
  if (authors.length === 1) return `By ${authors[0].name}`;
  const head = authors.slice(0, -1).map((a) => a.name).join(", ");
  return `By ${head} and ${authors[authors.length - 1].name}`;
}

export function blogDate(iso?: string): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return "";
  }
}

// ── Payload doc → native type mappers ────────────────────────────────────────
function mapMedia(m: any): BlogMedia | undefined {
  if (!m || typeof m !== "object") return undefined;
  return {
    id: String(m.id ?? ""),
    url: absUrl(m.url) ?? "",
    alt: m.alt ?? undefined,
    width: m.width ?? undefined,
    height: m.height ?? undefined,
    sizes: {
      thumbnail: absUrl(m.sizes?.thumbnail?.url),
      card: absUrl(m.sizes?.card?.url),
      og: absUrl(m.sizes?.og?.url),
    },
  };
}

function mapAuthor(a: any): BlogAuthor | null {
  if (!a || typeof a !== "object") return null;
  return {
    id: String(a.id ?? ""),
    name: a.name,
    slug: a.slug ?? undefined,
    role: a.role ?? undefined,
    bio: a.bio ?? undefined,
    avatar: mapMedia(a.avatar),
  };
}

function mapCategory(c: any): BlogCategory | null {
  if (!c || typeof c !== "object") return null;
  return {
    id: String(c.id ?? ""),
    title: c.title,
    slug: c.slug,
    accentColor: c.accentColor ?? undefined,
  };
}

function docToPost(d: any): BlogPost {
  return {
    id: String(d.id),
    title: d.title,
    slug: d.slug,
    excerpt: d.excerpt ?? undefined,
    eyebrow: d.eyebrow ?? undefined,
    content: d.content ?? undefined,
    publishedAt: d.publishedAt ?? undefined,
    heroImage: mapMedia(d.heroImage),
    heroCaption: d.heroCaption ?? undefined,
    authors: Array.isArray(d.authors)
      ? (d.authors.map(mapAuthor).filter(Boolean) as BlogAuthor[])
      : [],
    categories: Array.isArray(d.categories)
      ? (d.categories.map(mapCategory).filter(Boolean) as BlogCategory[])
      : [],
    tags: Array.isArray(d.tags) ? d.tags : undefined,
    featured: !!d.featured,
    editorsPick: !!d.editorsPick,
    trending: !!d.trending,
    readTime: d.readTime != null ? Number(d.readTime) : undefined,
  };
}

// ── REST query core ──────────────────────────────────────────────────────────
async function getJson(path: string): Promise<any> {
  const res = await fetch(`${API}${path}`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`Blog API ${res.status} for ${path}`);
  }
  return res.json();
}

const PUBLISHED = "where[_status][equals]=published";

export type BlogPostsPage = {
  docs: BlogPost[];
  page: number;
  totalPages: number;
  hasNextPage: boolean;
};

export async function fetchBlogPosts(opts: {
  page?: number;
  limit?: number;
  category?: string;
} = {}): Promise<BlogPostsPage> {
  const { page = 1, limit = 12, category } = opts;
  const params = [
    PUBLISHED,
    category ? `where[categories.slug][equals]=${encodeURIComponent(category)}` : "",
    "sort=-publishedAt",
    "depth=2",
    `limit=${limit}`,
    `page=${page}`,
  ]
    .filter(Boolean)
    .join("&");
  const json = await getJson(`/posts?${params}`);
  return {
    docs: Array.isArray(json?.docs) ? json.docs.map(docToPost) : [],
    page: json?.page ?? page,
    totalPages: json?.totalPages ?? 1,
    hasNextPage: !!json?.hasNextPage,
  };
}

export async function fetchBlogPostBySlug(slug: string): Promise<BlogPost | null> {
  const params = [
    PUBLISHED,
    `where[slug][equals]=${encodeURIComponent(slug)}`,
    "depth=2",
    "limit=1",
  ].join("&");
  const json = await getJson(`/posts?${params}`);
  const doc = Array.isArray(json?.docs) ? json.docs[0] : undefined;
  return doc ? docToPost(doc) : null;
}

export async function fetchBlogCategories(): Promise<BlogCategory[]> {
  const json = await getJson(`/categories?limit=50&sort=order`);
  return Array.isArray(json?.docs)
    ? (json.docs.map(mapCategory).filter(Boolean) as BlogCategory[])
    : [];
}
