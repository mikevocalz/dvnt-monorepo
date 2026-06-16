/**
 * getVideoThumbnail — reusable video thumbnail service
 *
 * Architecture: single function that callers (hooks, components) import.
 * The UI never imports expo-video-thumbnails directly — swap this file
 * to migrate to a different thumbnail backend without touching any UI code.
 *
 * Features:
 * - Timeout guard (avoids the iOS 26 beta hang)
 * - In-flight dedup (same URI won't generate twice simultaneously)
 * - Module-level Map cache (survives renders, cleared on reload)
 * - Graceful null fallback — callers must handle null
 */

import * as VideoThumbnails from "expo-video-thumbnails";

const TIMEOUT_MS = 10000;
const MAX_CACHE_SIZE = 200;

const memoryCache = new Map<string, string>();
const inFlight = new Map<string, Promise<string | null>>();

function isValidVideoUri(uri: string): boolean {
  return (
    typeof uri === "string" &&
    uri.length > 0 &&
    (uri.startsWith("http://") || uri.startsWith("https://") || uri.startsWith("file://"))
  );
}

async function generateThumbnail(uri: string): Promise<string | null> {
  return Promise.race<string | null>([
    VideoThumbnails.getThumbnailAsync(uri, { time: 0 })
      .then((r) => r.uri)
      .catch(() => null),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), TIMEOUT_MS)),
  ]);
}

/**
 * Returns a thumbnail URI for the given video, or null on failure.
 *
 * Migration path: to swap backend, change generateThumbnail() only.
 * Everything else (cache, dedup, timeout) stays the same.
 */
export async function getVideoThumbnail(videoUri: string): Promise<string | null> {
  if (!isValidVideoUri(videoUri)) return null;

  // 1. Memory cache hit
  const cached = memoryCache.get(videoUri);
  if (cached) return cached;

  // 2. Dedup: return existing in-flight promise
  const existing = inFlight.get(videoUri);
  if (existing) return existing;

  // 3. Launch generation
  const promise = generateThumbnail(videoUri)
    .then((uri) => {
      inFlight.delete(videoUri);
      if (uri) {
        // Evict oldest entry if cache is full
        if (memoryCache.size >= MAX_CACHE_SIZE) {
          const firstKey = memoryCache.keys().next().value;
          if (firstKey) memoryCache.delete(firstKey);
        }
        memoryCache.set(videoUri, uri);
      }
      return uri;
    })
    .catch(() => {
      inFlight.delete(videoUri);
      return null;
    });

  inFlight.set(videoUri, promise);
  return promise;
}

/** Pre-warm a thumbnail in the background — fire and forget */
export function prefetchVideoThumbnail(videoUri: string): void {
  if (!isValidVideoUri(videoUri) || memoryCache.has(videoUri)) return;
  getVideoThumbnail(videoUri).catch(() => null);
}

/** Clear the in-memory cache (useful in testing or low-memory situations) */
export function clearVideoThumbnailCache(): void {
  memoryCache.clear();
  inFlight.clear();
}
