/**
 * Klipy API client — Stickers, GIFs, Memes
 * Docs: https://docs.klipy.com
 *
 * Auth: Bearer token in Authorization header.
 * Base URL: https://api.klipy.com/v1
 */

const KLIPY_BASE = "https://api.klipy.com/v1";
const KLIPY_API_KEY = process.env.EXPO_PUBLIC_KLIPY_API_KEY ?? "";
const NOTO_GIF_BASE = "https://fonts.gstatic.com/s/e/notoemoji/latest";

// ── Types ──────────────────────────────────────────────

export type KlipyTab = "stickers" | "gifs" | "memes";

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

export interface KlipyAutocompleteResponse {
  results: string[];
}

// ── Helpers ────────────────────────────────────────────

function buildUrl(path: string, params: Record<string, string>): string {
  const url = new URL(`${KLIPY_BASE}${path}`);
  for (const [k, v] of Object.entries(params)) {
    if (v) url.searchParams.set(k, v);
  }
  return url.toString();
}

class KlipyNoContentError extends Error {
  readonly status = 204;

  constructor(message = "Klipy returned 204 No Content") {
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
    headers: {
      Authorization: `Bearer ${KLIPY_API_KEY}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    signal,
  });

  if (!res.ok && res.status !== 204) {
    const errText = await res.text().catch(() => "");
    console.error("[Klipy] API error:", res.status, errText);
    throw new Error(`Klipy API error: ${res.status}`);
  }

  if (res.status === 204) {
    throw new KlipyNoContentError(
      "[Klipy] 204 No Content — key may be test-restricted",
    );
  }

  const text = await res.text();
  if (!text) return { results: [] } as T;

  const json = JSON.parse(text);

  // Klipy may return { data: [...] } or { results: [...] }
  if (json.data && !json.results) {
    json.results = json.data;
  }

  return json as T;
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

// ── Tab → API path mapping ────────────────────────────
// Correct Klipy endpoints: /search/stickers, /search/gifs, /search (memes)

const TAB_SEARCH_PATH: Record<KlipyTab, string> = {
  stickers: "/search/stickers",
  gifs: "/search/gifs",
  memes: "/search",
};

// Default search terms when no user query (Klipy has no trending endpoint)
const TAB_DEFAULT_QUERY: Record<KlipyTab, string> = {
  stickers: "trending",
  gifs: "popular",
  memes: "funny",
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
    console.warn("[Klipy] Missing EXPO_PUBLIC_KLIPY_API_KEY");
    return tab === "gifs"
      ? fallbackGifSearch(effectiveQuery, limit, "missing_api_key")
      : { results: [] };
  }

  try {
    const response = await klipyFetch<KlipySearchResponse>(
      TAB_SEARCH_PATH[tab],
      {
        q: effectiveQuery,
        limit: String(limit),
        ...(options?.next ? { pos: options.next } : {}),
      },
      options?.signal,
    );

    return {
      ...response,
      source: "klipy",
    };
  } catch (error) {
    if (isAbortError(error)) {
      throw error;
    }

    if (tab === "gifs" && error instanceof KlipyNoContentError) {
      console.warn("[Klipy] Falling back to bundled animated GIFs");
      return fallbackGifSearch(effectiveQuery, limit, "restricted_key");
    }

    if (tab === "gifs") {
      console.warn("[Klipy] GIF request failed, using fallback library", error);
      return fallbackGifSearch(effectiveQuery, limit, "request_failed");
    }

    throw error;
  }
}

export async function klipyAutocomplete(
  query: string,
  signal?: AbortSignal,
): Promise<string[]> {
  if (!query.trim()) return [];
  if (!KLIPY_API_KEY) return [];

  try {
    const data = await klipyFetch<KlipyAutocompleteResponse>(
      "/autocomplete",
      { q: query.trim(), limit: "8" },
      signal,
    );

    return data.results ?? [];
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
 * Prioritizes transparent formats for stickers, full-size for GIFs/memes.
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

  if (tab === "gifs") {
    return m.gif?.url ?? m.mediumgif?.url ?? m.tinygif?.url ?? "";
  }

  // memes
  return m.gif?.url ?? m.png?.url ?? m.tinygif?.url ?? m.tinypng?.url ?? "";
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
    m.nanogif?.url ??
    m.tinygif?.url ??
    m.nanopng?.url ??
    getItemImageUri(item, tab)
  );
}
