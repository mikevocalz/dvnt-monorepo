/**
 * extractDominantColor — base module. Bundlers without a platform resolver fall
 * back to this (→ the web impl). Metro picks `.native.ts`, web bundlers `.web.ts`.
 *
 * One signature across platforms: given the best available media for an event,
 * return a representative "#rrggbb" or null (never throws — callers fall back to
 * the brand gradient on null). A still image is sampled directly; a video has a
 * frame pulled first (canvas on web, expo-video-thumbnails on native) and the
 * frame is sampled.
 */

export type { ExtractInput } from "./normalizeColor";

export { extractDominantColor } from "./extractDominantColor.web";
