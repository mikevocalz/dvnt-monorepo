/**
 * Klipy API client — Stickers and GIFs
 * Docs: https://docs.klipy.com
 *
 * Auth: the app key is a path segment, not a header.
 * Base URL: https://api.klipy.com/api/v1/{appKey}/{catalogue}/search
 */

import { emitLog } from "@dvnt/observability";

const KLIPY_BASE = "https://api.klipy.com/api/v1";
const KLIPY_API_KEY = process.env.EXPO_PUBLIC_KLIPY_API_KEY ?? "";
const NOTO_GIF_BASE = "https://fonts.gstatic.com/s/e/notoemoji/latest";

// ── Types ──────────────────────────────────────────────

export type KlipyTab = "stickers" | "gifs";

export interface KlipyMediaFormat {
  url: string;
  width: number;
  height: number;
  size?: number;
}

export interface KlipyItem {
  id: string;
  title: string;
  content_description?: string;
  media_formats: {
    gif?: KlipyMediaFormat;
    tinygif?: KlipyMediaFormat;
    nanogif?: KlipyMediaFormat;
    mediumgif?: KlipyMediaFormat;
    mp4?: KlipyMediaFormat;
    tinymp4?: KlipyMediaFormat;
    nanomp4?: KlipyMediaFormat;
    webm?: KlipyMediaFormat;
    tinywebm?: KlipyMediaFormat;
    nanowebm?: KlipyMediaFormat;
    webp?: KlipyMediaFormat;
    tinywebp?: KlipyMediaFormat;
    nanowebp?: KlipyMediaFormat;
    webp_transparent?: KlipyMediaFormat;
    tinywebp_transparent?: KlipyMediaFormat;
    nanowebp_transparent?: KlipyMediaFormat;
    gif_transparent?: KlipyMediaFormat;
    tinygif_transparent?: KlipyMediaFormat;
    nanogif_transparent?: KlipyMediaFormat;
    png?: KlipyMediaFormat;
    tinypng?: KlipyMediaFormat;
    nanopng?: KlipyMediaFormat;
  };
  created: number;
  url: string;
  tags?: string[];
  hasaudio?: boolean;
}

export interface KlipySearchResponse {
  results: KlipyItem[];
  next?: string;
  source?: "klipy" | "fallback";
  fallbackReason?: "missing_api_key" | "restricted_key" | "request_failed";
}

export interface KlipyCategoriesResponse {
  data?: { categories?: { category?: string; query?: string }[] };
}

// ── Helpers ────────────────────────────────────────────

function buildUrl(path: string, params: Record<string, string>): string {
  const url = new URL(`${KLIPY_BASE}/${KLIPY_API_KEY}${path}`);
  for (const [k, v] of Object.entries(params)) {
    if (v) url.searchParams.set(k, v);
  }
  return url.toString();
}

class KlipyNoContentError extends Error {
  readonly status = 204;

  constructor(message = "Klipy returned no content") {
    super(message);
    this.name = "KlipyNoContentError";
  }
}

function isAbortError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    (error as { name?: string }).name === "AbortError"
  );
}

async function klipyFetch<T>(
  path: string,
  params: Record<string, string>,
  signal?: AbortSignal,
): Promise<T> {
  const url = buildUrl(path, params);
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    signal,
  });

  if (!res.ok && res.status !== 204) {
    emitLog("warn", "Klipy request failed", {
      feature: "stickers.klipy",
      path,
      status: res.status,
    });
    throw new Error(`Klipy request failed with status ${res.status}`);
  }

  if (res.status === 204) {
    throw new KlipyNoContentError();
  }

  const text = await res.text();
  if (!text) throw new KlipyNoContentError();

  return JSON.parse(text) as T;
}

// ── Response shape ─────────────────────────────────────
// Klipy nests one page under `data.data` and splits every asset into four
// render sizes (hd/md/sm/xs); the app consumes the flattened KlipyItem instead.

interface KlipyRawFile {
  url: string;
  width: number;
  height: number;
  size?: number;
}

type KlipyRawVariant = Partial<
  Record<"gif" | "webp" | "png" | "jpg" | "mp4" | "webm", KlipyRawFile>
>;

interface KlipyRawItem {
  id: number | string;
  slug?: string;
  title?: string;
  tags?: string[];
  file?: Partial<Record<"hd" | "md" | "sm" | "xs", KlipyRawVariant>>;
}

interface KlipyRawPage {
  data?: KlipyRawItem[];
  current_page?: number;
  has_next?: boolean;
}

interface KlipyRawResponse {
  result?: boolean;
  data?: KlipyRawPage;
}

function firstFile(
  ...candidates: (KlipyRawFile | undefined)[]
): KlipyRawFile | undefined {
  return candidates.find((file) => Boolean(file?.url));
}

function toKlipyItem(raw: KlipyRawItem, tab: KlipyTab): KlipyItem {
  const hd = raw.file?.hd ?? {};
  const md = raw.file?.md ?? {};
  const sm = raw.file?.sm ?? {};
  const xs = raw.file?.xs ?? {};

  const gif = firstFile(hd.gif, md.gif, sm.gif, xs.gif);
  const title = raw.title ?? "";

  return {
    // Klipy ids exceed Number.MAX_SAFE_INTEGER and lose digits through
    // JSON.parse, so the slug is the only stable per-item key.
    id: raw.slug ?? String(raw.id),
    title,
    content_description: title,
    media_formats: {
      gif,
      mediumgif: firstFile(md.gif, gif),
      tinygif: firstFile(sm.gif, md.gif, gif),
      nanogif: firstFile(xs.gif, sm.gif, gif),
      mp4: firstFile(hd.mp4, md.mp4),
      tinymp4: firstFile(sm.mp4, md.mp4),
      nanomp4: firstFile(xs.mp4, sm.mp4),
      webm: firstFile(hd.webm, md.webm),
      tinywebm: firstFile(sm.webm, md.webm),
      nanowebm: firstFile(xs.webm, sm.webm),
      // Animated WebP, the same clip at roughly half the GIF's bytes
      // (measured 873,745 -> 435,968 at md). expo-image and <img> both play
      // it, so this is a format swap and not a renderer change.
      webp: firstFile(hd.webp, md.webp, sm.webp, xs.webp),
      tinywebp: firstFile(sm.webp, md.webp, xs.webp),
      nanowebp: firstFile(xs.webp, sm.webp, md.webp),
      png: firstFile(hd.png, md.png),
      tinypng: firstFile(sm.png, md.png),
      nanopng: firstFile(xs.png, sm.png),
      // Only the sticker catalogue ships alpha, so transparent slots stay empty
      // for GIFs — getItemImageUri would otherwise pick an opaque frame.
      ...(tab === "stickers"
        ? {
            webp_transparent: firstFile(hd.webp, md.webp),
            tinywebp_transparent: firstFile(sm.webp, md.webp),
            nanowebp_transparent: firstFile(xs.webp, sm.webp),
            gif_transparent: firstFile(hd.gif, md.gif),
            tinygif_transparent: firstFile(sm.gif, md.gif),
            nanogif_transparent: firstFile(xs.gif, sm.gif),
          }
        : {}),
    },
    created: 0,
    url: gif?.url ?? firstFile(hd.webp, hd.png)?.url ?? "",
    tags: raw.tags ?? [],
    hasaudio: false,
  };
}

type FallbackGifDefinition = {
  id: string;
  title: string;
  codepoint: string;
  tags: string[];
};

const FALLBACK_GIFS: FallbackGifDefinition[] = [
  {
    id: "party",
    title: "Party",
    codepoint: "1f389",
    tags: ["party", "celebrate", "confetti", "yay", "fun"],
  },
  {
    id: "sparkles",
    title: "Sparkles",
    codepoint: "2728",
    tags: ["sparkle", "magic", "shine", "cute", "vibes"],
  },
  {
    id: "fire",
    title: "Fire",
    codepoint: "1f525",
    tags: ["fire", "lit", "hot", "slay", "energy"],
  },
  {
    id: "joy",
    title: "Tears of Joy",
    codepoint: "1f602",
    tags: ["happy", "lol", "laugh", "funny", "reaction"],
  },
  {
    id: "heart-eyes",
    title: "Heart Eyes",
    codepoint: "1f60d",
    tags: ["love", "heart", "obsessed", "cute", "crush"],
  },
  {
    id: "smile",
    title: "Smile",
    codepoint: "1f603",
    tags: ["happy", "smile", "good", "sweet", "nice"],
  },
  {
    id: "cool",
    title: "Cool",
    codepoint: "1f60e",
    tags: ["cool", "chill", "smooth", "vibes", "swag"],
  },
  {
    id: "mind-blown",
    title: "Mind Blown",
    codepoint: "1f92f",
    tags: ["wow", "mind blown", "shook", "omg", "reaction"],
  },
  {
    id: "sob",
    title: "Sob",
    codepoint: "1f62d",
    tags: ["cry", "sad", "tears", "emotional", "mood"],
  },
  {
    id: "angry",
    title: "Angry",
    codepoint: "1f621",
    tags: ["mad", "angry", "annoyed", "ugh", "no"],
  },
  {
    id: "clap",
    title: "Clap",
    codepoint: "1f44f",
    tags: ["clap", "applause", "yes", "bravo", "support"],
  },
  {
    id: "thumbs-up",
    title: "Thumbs Up",
    codepoint: "1f44d",
    tags: ["yes", "like", "approve", "good", "okay"],
  },
  {
    id: "hands-up",
    title: "Hands Up",
    codepoint: "1f64c",
    tags: ["praise", "celebrate", "win", "success", "blessed"],
  },
  {
    id: "dance",
    title: "Dance",
    codepoint: "1f57a",
    tags: ["dance", "party", "groove", "music", "celebrate"],
  },
  {
    id: "rocket",
    title: "Rocket",
    codepoint: "1f680",
    tags: ["rocket", "launch", "go", "up", "hype"],
  },
  {
    id: "lightning",
    title: "Lightning",
    codepoint: "26a1",
    tags: ["lightning", "fast", "energy", "electric", "power"],
  },
];

function fallbackGifUrl(codepoint: string): string {
  return `${NOTO_GIF_BASE}/${codepoint}/512.gif`;
}

function fallbackGifToItem(def: FallbackGifDefinition): KlipyItem {
  const url = fallbackGifUrl(def.codepoint);
  const size = { url, width: 512, height: 512 };

  return {
    id: `fallback-${def.id}`,
    title: def.title,
    content_description: def.title,
    media_formats: {
      gif: size,
      mediumgif: size,
      tinygif: size,
      nanogif: size,
    },
    created: 0,
    url,
    tags: def.tags,
    hasaudio: false,
  };
}

function fallbackScore(def: FallbackGifDefinition, query: string): number {
  const q = query.trim().toLowerCase();
  if (!q || q === TAB_DEFAULT_QUERY.gifs) return 1;

  const title = def.title.toLowerCase();
  if (title.includes(q)) return 5;
  if (def.tags.some((tag) => tag.includes(q))) return 4;

  const terms = q.split(/\s+/).filter(Boolean);
  if (terms.length === 0) return 1;

  return terms.reduce((score, term) => {
    if (title.includes(term)) return score + 3;
    if (def.tags.some((tag) => tag.includes(term))) return score + 2;
    return score;
  }, 0);
}

function fallbackGifSearch(
  query: string,
  limit: number,
  reason: KlipySearchResponse["fallbackReason"],
): KlipySearchResponse {
  const ranked = FALLBACK_GIFS.map((item) => ({
    item,
    score: fallbackScore(item, query),
  }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score);

  return {
    results: ranked.slice(0, limit).map(({ item }) => fallbackGifToItem(item)),
    source: "fallback",
    fallbackReason: reason,
  };
}

// ── Tab → catalogue mapping ───────────────────────────

const TAB_CATALOGUE: Record<KlipyTab, string> = {
  stickers: "stickers",
  gifs: "gifs",
};

// Default search terms when no user query
const TAB_DEFAULT_QUERY: Record<KlipyTab, string> = {
  stickers: "trending",
  gifs: "popular",
};

// ── Public API ─────────────────────────────────────────

export async function klipySearch(
  tab: KlipyTab,
  query: string,
  options?: { limit?: number; next?: string; signal?: AbortSignal },
): Promise<KlipySearchResponse> {
  // Klipy requires a query — empty search returns empty.
  // Use a default query when user hasn't typed anything.
  const effectiveQuery = query.trim() || TAB_DEFAULT_QUERY[tab];
  const limit = options?.limit ?? 30;

  if (!KLIPY_API_KEY) {
    emitLog("warn", "Klipy search skipped without an API key", {
      feature: "stickers.klipy",
      tab,
    });
    return tab === "gifs"
      ? fallbackGifSearch(effectiveQuery, limit, "missing_api_key")
      : { results: [] };
  }

  try {
    const response = await klipyFetch<KlipyRawResponse>(
      `/${TAB_CATALOGUE[tab]}/search`,
      {
        q: effectiveQuery,
        per_page: String(limit),
        ...(options?.next ? { page: options.next } : {}),
      },
      options?.signal,
    );

    const page = response.data;
    const results = (page?.data ?? []).map((raw) => toKlipyItem(raw, tab));

    return {
      results,
      ...(page?.has_next ? { next: String((page.current_page ?? 1) + 1) } : {}),
      source: "klipy",
    };
  } catch (error) {
    if (isAbortError(error)) {
      throw error;
    }

    if (tab === "gifs") {
      return fallbackGifSearch(
        effectiveQuery,
        limit,
        error instanceof KlipyNoContentError
          ? "restricted_key"
          : "request_failed",
      );
    }

    throw error;
  }
}

// Klipy publishes a category list rather than a per-keystroke suggest endpoint,
// so suggestions are that list narrowed to what the user has typed.
export async function klipyAutocomplete(
  query: string,
  signal?: AbortSignal,
): Promise<string[]> {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  if (!KLIPY_API_KEY) return [];

  try {
    const response = await klipyFetch<KlipyCategoriesResponse>(
      "/gifs/categories",
      {},
      signal,
    );

    return (response.data?.categories ?? [])
      .map((entry) => entry.query ?? entry.category ?? "")
      .filter((term) => term.toLowerCase().includes(q))
      .slice(0, 8);
  } catch (error) {
    if (isAbortError(error)) {
      throw error;
    }

    if (error instanceof KlipyNoContentError) {
      return [];
    }
    throw error;
  }
}

// ── URI extraction ─────────────────────────────────────

/**
 * Extract the best image URI from a Klipy item for canvas insertion.
 * Prioritizes transparent formats for stickers, full-size for GIFs.
 */
export function getItemImageUri(item: KlipyItem, tab: KlipyTab): string {
  const m = item.media_formats;

  if (tab === "stickers") {
    return (
      m.webp_transparent?.url ??
      m.tinywebp_transparent?.url ??
      m.gif_transparent?.url ??
      m.tinygif_transparent?.url ??
      m.png?.url ??
      m.tinypng?.url ??
      m.gif?.url ??
      m.tinygif?.url ??
      ""
    );
  }

  return (
    m.webp?.url ??
    m.gif?.url ??
    m.mediumgif?.url ??
    m.tinygif?.url ??
    ""
  );
}

/**
 * Extract a small preview URI for grid thumbnails.
 */
export function getItemPreviewUri(item: KlipyItem, tab: KlipyTab): string {
  const m = item.media_formats;

  if (tab === "stickers") {
    return (
      m.nanowebp_transparent?.url ??
      m.tinywebp_transparent?.url ??
      m.nanogif_transparent?.url ??
      m.nanopng?.url ??
      m.nanogif?.url ??
      getItemImageUri(item, tab)
    );
  }

  return (
    m.nanowebp?.url ??
    m.tinywebp?.url ??
    m.nanogif?.url ??
    m.tinygif?.url ??
    m.nanopng?.url ??
    getItemImageUri(item, tab)
  );
}
