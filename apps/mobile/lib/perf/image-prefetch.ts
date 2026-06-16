/**
 * Image Prefetch — Warm image caches for off-screen content
 *
 * Uses requestIdleCallback (or setTimeout fallback) to prefetch images
 * during idle frames, ensuring no jank on the main thread.
 *
 * TWO cache systems in this app:
 * - expo-image (used by our components via `Image` from "expo-image")
 * - React Native Image (used by 3rd-party libs like react-native-insta-story)
 *
 * `prefetchImages()` warms expo-image cache.
 * `prefetchImagesRN()` warms React Native's Image cache.
 * For content rendered by 3rd-party libs, call BOTH or just prefetchImagesRN.
 *
 * SAFETY: every URL is validated to be a non-empty http(s)/file string
 * before being passed to native. expo-image's iOS prefetch path
 * (SDWebImage) can throw NSException on malformed input — that throws
 * on a dispatch worker thread and there's no native catch, so it
 * propagates to objc_terminate and aborts the process. The
 * `sanitizeUrls` helper below blocks every code path that reaches
 * `Image.prefetch`.
 */

import { Image } from "expo-image";
import { Image as RNImage } from "react-native";

const MAX_PREFETCH_BATCH = 30;
const PREFETCH_DELAY_MS = 500;

/**
 * Strict URL validation. expo-image's native side will throw on:
 *   - non-string values
 *   - empty strings
 *   - URLs with unrecognized schemes (especially malformed `data:` URIs)
 * Returns only safe http(s)/file URLs.
 */
function sanitizeUrls(urls: unknown[]): string[] {
  const safe: string[] = [];
  for (const u of urls) {
    if (typeof u !== "string") continue;
    const trimmed = u.trim();
    if (trimmed.length === 0) continue;
    if (
      !trimmed.startsWith("https://") &&
      !trimmed.startsWith("http://") &&
      !trimmed.startsWith("file://")
    ) {
      continue;
    }
    safe.push(trimmed);
  }
  return safe;
}

/**
 * Prefetch a batch of image URLs into expo-image cache.
 * Safe to call with duplicates — expo-image deduplicates internally.
 */
export function prefetchImages(urls: string[]) {
  if (!urls.length) return;

  const batch = sanitizeUrls(urls).slice(0, MAX_PREFETCH_BATCH);
  if (!batch.length) return;

  const schedule =
    typeof requestIdleCallback !== "undefined"
      ? requestIdleCallback
      : (cb: () => void) => setTimeout(cb, PREFETCH_DELAY_MS);

  schedule(() => {
    try {
      // Image.prefetch returns a Promise on expo-image. Always attach
      // a .catch — an unhandled rejection here can become an NSException
      // when the underlying SDWebImage operation fails, depending on
      // the failure path.
      const result = Image.prefetch(batch);
      if (result && typeof (result as Promise<unknown>).catch === "function") {
        (result as Promise<unknown>).catch((err) => {
          if (__DEV__) {
            console.warn("[ImagePrefetch] expo-image rejected:", err);
          }
        });
      }
      if (__DEV__) {
        console.log(
          `[ImagePrefetch] expo-image: queued ${batch.length} images`,
        );
      }
    } catch (err) {
      if (__DEV__) {
        console.warn("[ImagePrefetch] expo-image error:", err);
      }
    }
  });
}

/**
 * Prefetch a small batch of critical images synchronously before first paint.
 *
 * Races against a hard timeout so a slow CDN or stalled URL never holds
 * the feed render. If the timeout fires first, the feed renders anyway
 * (images will pop in as they finish loading in the background) — this
 * is strictly better than holding the UI blank waiting for network.
 */
export async function prefetchImagesBlocking(urls: string[]) {
  if (!urls.length) return;

  const batch = sanitizeUrls(urls).slice(0, Math.min(MAX_PREFETCH_BATCH, 8));
  if (!batch.length) return;

  const BLOCKING_BUDGET_MS = 1200;

  try {
    await Promise.race([
      Image.prefetch(batch).catch((err) => {
        if (__DEV__) {
          console.warn("[ImagePrefetch] expo-image blocking rejected:", err);
        }
      }),
      new Promise<void>((resolve) => setTimeout(resolve, BLOCKING_BUDGET_MS)),
    ]);
    if (__DEV__) {
      console.log(
        `[ImagePrefetch] expo-image: critical batch (${batch.length}) done or timed out at ${BLOCKING_BUDGET_MS}ms`,
      );
    }
  } catch (err) {
    if (__DEV__) {
      console.warn("[ImagePrefetch] expo-image blocking error:", err);
    }
  }
}

/**
 * Prefetch image URLs into React Native's built-in Image cache.
 * Required for 3rd-party components that use RN's Image (e.g. react-native-insta-story).
 * expo-image and RN Image have SEPARATE caches — prefetching one does NOT warm the other.
 */
export function prefetchImagesRN(urls: string[]) {
  if (!urls.length) return;

  const batch = sanitizeUrls(urls).slice(0, MAX_PREFETCH_BATCH);
  if (!batch.length) return;

  // RN Image.prefetch is per-URL, fire them all immediately (no idle scheduling)
  // They run on native threads and don't block JS.
  for (const url of batch) {
    try {
      RNImage.prefetch(url).catch(() => {
        // Silent fail — prefetch is best-effort
      });
    } catch {
      // Defense in depth — RNImage.prefetch shouldn't throw synchronously
      // but if it ever does, swallow it.
    }
  }

  if (__DEV__) {
    console.log(`[ImagePrefetch] RN Image: prefetching ${batch.length} images`);
  }
}

/**
 * Extract prefetchable image URLs from feed posts.
 * Focuses on the first media item per post (the hero image).
 */
export function extractFeedImageUrls(
  posts: { media?: { url: string; type: string }[] }[],
): string[] {
  const urls: string[] = [];

  for (const post of posts) {
    if (!post.media?.length) continue;
    const firstMedia = post.media[0];
    // Skip GIFs — expo-image's iOS prefetch path runs SDWebImage
    // animated-image decoding, which can throw NSException on certain
    // malformed/large GIFs. Those throws land on a dispatch worker
    // with no native catch and crash the process. GIFs load fresh
    // when rendered and animate correctly. (Reverted from a prior
    // change that removed this guard — that change correlated with
    // the scroll-time `performVoidMethodInvocation` crash.)
    // Skip videos for the same prefetch-vs-streaming reason.
    if (
      firstMedia?.url &&
      firstMedia.type !== "video" &&
      firstMedia.type !== "gif"
    ) {
      urls.push(firstMedia.url);
    }
  }

  return urls;
}

/**
 * Prefetch avatar URLs from a list of users.
 */
export function prefetchAvatars(avatarUrls: (string | null | undefined)[]) {
  const valid = sanitizeUrls(avatarUrls);
  if (valid.length > 0) {
    prefetchImages(valid);
  }
}
