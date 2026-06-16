import { create } from "zustand";
import { mmkv } from "@dvnt/app/lib/mmkv-zustand";
import { useState, useEffect } from "react";
import DVNTTranslationModule from "@dvnt/app/modules/dvnt-translation/src/TranslationModule";
import { translateText as nativeTranslate } from "@dvnt/app/modules/dvnt-translation/src";

// ── Capability probe — checked once per app session ───────────────────────────
//
// Uses TranslationModule.isTranslationAvailable as the capability signal:
//   • 1.0.213 stub   : throws          → caught → false → button hidden
//   • 1.0.214 iOS 17.4+ : true/false   → surface translate button accordingly
//   • 1.0.214 iOS <17.4 : false        → button hidden (graceful)
//   • module null    : false            → button hidden

let _capabilityPromise: Promise<boolean> | null = null;

function checkNativeCapability(): Promise<boolean> {
  if (_capabilityPromise) return _capabilityPromise;
  _capabilityPromise = (async () => {
    if (!DVNTTranslationModule) return false;
    try {
      return await DVNTTranslationModule.isTranslationAvailable("en", "es");
    } catch {
      return false;
    }
  })();
  return _capabilityPromise;
}

// ── Store ─────────────────────────────────────────────────────────────────────

interface TranslationState {
  // Cache: contentHash -> translated text
  cache: Map<string, string>;
  // Track which content IDs are currently showing translation
  activeTranslations: Set<string>;
  // Loading states
  loadingContentIds: Set<string>;

  // Actions
  getCachedTranslation: (contentHash: string) => string | undefined;
  setTranslation: (contentHash: string, translatedText: string) => void;
  isTranslated: (contentId: string) => boolean;
  toggleTranslation: (contentId: string) => void;
  setLoading: (contentId: string, loading: boolean) => void;
  isLoading: (contentId: string) => boolean;
  clearCache: () => void;
}

const CACHE_PREFIX = "translation_cache_";
const MAX_CACHE_ENTRIES = 500;

function hashContent(
  text: string,
  sourceLang: string,
  targetLang: string,
): string {
  const str = `${text}:${sourceLang}:${targetLang}`;
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return `${CACHE_PREFIX}${Math.abs(hash)}`;
}

export const useTranslationStore = create<TranslationState>((set, get) => ({
  cache: new Map(),
  activeTranslations: new Set(),
  loadingContentIds: new Set(),

  getCachedTranslation: (contentHash: string) => {
    const memCached = get().cache.get(contentHash);
    if (memCached) return memCached;

    const stored = mmkv.getString(contentHash);
    if (stored) {
      get().cache.set(contentHash, stored);
      return stored;
    }
    return undefined;
  },

  setTranslation: (contentHash: string, translatedText: string) => {
    const newCache = new Map(get().cache);
    newCache.set(contentHash, translatedText);

    if (newCache.size > MAX_CACHE_ENTRIES) {
      const iterator = newCache.keys();
      const firstResult = iterator.next();
      if (!firstResult.done && firstResult.value) {
        newCache.delete(firstResult.value);
      }
    }

    set({ cache: newCache });
    mmkv.set(contentHash, translatedText);
  },

  isTranslated: (contentId: string) => {
    return get().activeTranslations.has(contentId);
  },

  toggleTranslation: (contentId: string) => {
    const newSet = new Set(get().activeTranslations);
    if (newSet.has(contentId)) {
      newSet.delete(contentId);
    } else {
      newSet.add(contentId);
    }
    set({ activeTranslations: newSet });
  },

  setLoading: (contentId: string, loading: boolean) => {
    const newSet = new Set(get().loadingContentIds);
    if (loading) {
      newSet.add(contentId);
    } else {
      newSet.delete(contentId);
    }
    set({ loadingContentIds: newSet });
  },

  isLoading: (contentId: string) => {
    return get().loadingContentIds.has(contentId);
  },

  clearCache: () => {
    set({ cache: new Map(), activeTranslations: new Set() });
    const keys = mmkv.getAllKeys().filter((k) => k.startsWith(CACHE_PREFIX));
    keys.forEach((k) => mmkv.remove(k));
  },
}));

// ── useContentTranslation — per-content translation hook ─────────────────────
//
// Returns `isCapable: boolean | null`:
//   null  = still checking (hide button)
//   false = native translation unavailable (hide button)
//   true  = native translation available (show button if text is foreign)

export function useContentTranslation(
  contentId: string,
  originalText: string,
  targetLang: string,
) {
  const store = useTranslationStore();
  const contentHash = hashContent(originalText, "en", targetLang);

  // Capability: null=checking, false=unavailable, true=available
  const [isCapable, setIsCapable] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    checkNativeCapability().then((capable) => {
      if (!cancelled) setIsCapable(capable);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const isTranslated = store.isTranslated(contentId);
  const isLoading = store.isLoading(contentId);
  const cachedTranslation = store.getCachedTranslation(contentHash);

  const translate = async () => {
    if (cachedTranslation) {
      store.toggleTranslation(contentId);
      return cachedTranslation;
    }

    store.setLoading(contentId, true);
    try {
      const translated = await translateText(originalText, targetLang);
      store.setTranslation(contentHash, translated);
      store.toggleTranslation(contentId);
      return translated;
    } catch (err) {
      throw err;
    } finally {
      store.setLoading(contentId, false);
    }
  };

  const showOriginal = () => {
    store.toggleTranslation(contentId);
  };

  const displayText = isTranslated
    ? (cachedTranslation ?? originalText)
    : originalText;

  return {
    displayText,
    isTranslated,
    isLoading,
    isCapable,
    translate,
    showOriginal,
    hasTranslation: !!cachedTranslation,
  };
}

// ── On-device translation — Apple Translation (iOS) / web fallback ───────────
//
// P0-4 rebuild: the translation pipeline must work end-to-end on EVERY
// device regardless of native module availability, iOS version, or
// installed language packs. The UI no longer gates on native capability,
// so this function is the contract: either return a good translation or
// throw a descriptive error the caller can surface to the user.
//
// Strategy (in order):
//   1. Native Apple Translation (iOS 18+ with installed packs) — fastest,
//      private, offline.
//   2. NL language detection + MyMemory (explicit pair) — works on every
//      platform; ~500 char limit per request so long text is chunked by
//      sentence boundary.
//   3. Lingva proxy (mirror of Google Translate, free + CORS-safe) as a
//      last-resort fallback if MyMemory fails or echoes the input.
//
// Any throw reaches TranslateButton which renders the error state.

const MYMEMORY_CHUNK = 450; // safety margin under the 500-char cap
const NETWORK_TIMEOUT_MS = 10_000;

async function detectSourceLanguage(text: string): Promise<string | null> {
  if (!DVNTTranslationModule) return null;
  try {
    const lang = await DVNTTranslationModule.detectLanguage(text);
    return lang && lang !== "und" ? lang.split("-")[0].toLowerCase() : null;
  } catch {
    return null;
  }
}

function splitForTranslation(text: string, max = MYMEMORY_CHUNK): string[] {
  if (text.length <= max) return [text];
  // Split on sentence-ending punctuation followed by whitespace, preserving
  // the delimiter. Falls back to hard character splits for pathological input.
  const parts = text.split(/(?<=[.!?\u3002\uFF01\uFF1F])\s+/);
  const out: string[] = [];
  let buf = "";
  for (const piece of parts) {
    if ((buf + " " + piece).trim().length > max) {
      if (buf) out.push(buf.trim());
      if (piece.length > max) {
        // Sentence alone is too long — hard-slice.
        for (let i = 0; i < piece.length; i += max) {
          out.push(piece.slice(i, i + max));
        }
        buf = "";
      } else {
        buf = piece;
      }
    } else {
      buf = buf ? `${buf} ${piece}` : piece;
    }
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

async function fetchWithTimeout(url: string, ms: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function isEcho(input: string, output: string): boolean {
  return input.trim().toLowerCase() === output.trim().toLowerCase();
}

async function translateViaMyMemory(
  chunk: string,
  src: string,
  tgt: string,
): Promise<string | null> {
  // MyMemory does not accept "auto" as source — default to "en" when unknown.
  const safeSrc = src && src !== tgt ? src : "en";
  const langPair = `${safeSrc}|${tgt}`;
  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(chunk)}&langpair=${langPair}`;
  try {
    const resp = await fetchWithTimeout(url, NETWORK_TIMEOUT_MS);
    if (!resp.ok) return null;
    const data: any = await resp.json().catch(() => null);
    const out = data?.responseData?.translatedText;
    if (typeof out !== "string" || !out.trim()) return null;
    if (isEcho(chunk, out)) return null;
    return out;
  } catch (err) {
    console.warn("[Translation] MyMemory error:", err);
    return null;
  }
}

async function translateViaLingva(
  chunk: string,
  src: string,
  tgt: string,
): Promise<string | null> {
  const s = src || "auto";
  const url = `https://lingva.ml/api/v1/${s}/${tgt}/${encodeURIComponent(chunk)}`;
  try {
    const resp = await fetchWithTimeout(url, NETWORK_TIMEOUT_MS);
    if (!resp.ok) return null;
    const data: any = await resp.json().catch(() => null);
    const out = data?.translation;
    if (typeof out !== "string" || !out.trim()) return null;
    if (isEcho(chunk, out)) return null;
    return out;
  } catch (err) {
    console.warn("[Translation] Lingva error:", err);
    return null;
  }
}

async function translateText(
  text: string,
  targetLang: string,
): Promise<string> {
  const tgt = (
    !targetLang || targetLang === "auto" ? "en" : targetLang.split("-")[0]
  ).toLowerCase();

  // 1. Native Apple Translation — only when the library is available.
  //    Any failure silently falls through to the web path.
  try {
    const result = await nativeTranslate(text, "auto", tgt);
    const out = result?.translatedText;
    if (typeof out === "string" && out.trim() && !isEcho(text, out)) {
      return out;
    }
  } catch (err) {
    console.log("[Translation] native unavailable, falling back:", err);
  }

  // 2. Detect source so the web call uses an explicit pair when possible.
  const detectedSrc = await detectSourceLanguage(text);
  const src = detectedSrc && detectedSrc !== tgt ? detectedSrc : "";

  // Chunk by sentence to respect MyMemory's per-request limit and give
  // long-form text (event descriptions) a real chance of full translation.
  const chunks = splitForTranslation(text);
  const translated: string[] = [];
  let myMemoryFailures = 0;
  for (const chunk of chunks) {
    const out = await translateViaMyMemory(chunk, src, tgt);
    if (out) {
      translated.push(out);
    } else {
      myMemoryFailures++;
      // Try Lingva for this chunk.
      const fallback = await translateViaLingva(chunk, src, tgt);
      if (fallback) {
        translated.push(fallback);
      } else {
        // Preserve original chunk so the reader never sees a hole mid-text.
        translated.push(chunk);
      }
    }
  }

  const combined = translated.join(" ").trim();
  if (!combined || isEcho(text, combined)) {
    throw new Error(
      myMemoryFailures >= chunks.length
        ? "Translation service unreachable. Check your connection and try again."
        : "Translation unavailable for this language pair.",
    );
  }
  return combined;
}
