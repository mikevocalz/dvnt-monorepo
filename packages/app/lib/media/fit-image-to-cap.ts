/**
 * Bring a picked image under its media-upload byte cap before it is sent.
 *
 * `uploadSingle` used to hand the picked file to `uploadToServer` untouched.
 * The avatar cap is 2 MB (upload-policy.ts, mirrored in media-upload), and a
 * phone photo is usually bigger, so the web branch of `uploadToServer`
 * refused it at the `blob.size > sizeLimitForKind(kind)` preflight. No request
 * left the browser, and the editor turned the refusal into a generic toast.
 *
 * This module only decides. The platform work (reading sizes, decoding,
 * re-encoding) comes in through `FitImageDeps`, so the decision runs under
 * `node --test` without expo.
 */

export interface ImageFitStep {
  /** Longest edge after resizing, in pixels. Never upscales. */
  maxEdge: number;
  /** JPEG quality, 0..1. */
  quality: number;
}

/** Tried in order until one encode fits. */
export const IMAGE_FIT_STEPS: readonly ImageFitStep[] = [
  { maxEdge: 1440, quality: 0.85 },
  { maxEdge: 1080, quality: 0.8 },
  { maxEdge: 1080, quality: 0.65 },
  { maxEdge: 720, quality: 0.65 },
  { maxEdge: 512, quality: 0.6 },
];

export interface FitImageDeps {
  /** Bytes behind a URI, or null when the platform cannot tell. */
  byteSize(uri: string): Promise<number | null>;
  /** Decoded pixel size. Throws when the platform cannot decode the image. */
  dimensions(uri: string): Promise<{ width: number; height: number }>;
  /** Re-encode as JPEG, resized when `resize` is set. Returns the new URI. */
  encode(
    uri: string,
    resize: { width: number; height: number } | null,
    quality: number,
  ): Promise<string>;
}

export type FitImageResult =
  | { ok: true; uri: string; bytes: number | null; reencoded: boolean }
  | { ok: false; error: string };

function mb(bytes: number): string {
  const v = bytes / (1024 * 1024);
  return v >= 10 ? String(Math.round(v)) : v.toFixed(1).replace(/\.0$/, "");
}

/** Target size for `maxEdge`, or null when the image is already small enough. */
export function scaleToFit(
  width: number,
  height: number,
  maxEdge: number,
): { width: number; height: number } | null {
  const longEdge = Math.max(width, height);
  if (!(longEdge > maxEdge)) return null;
  const scale = maxEdge / longEdge;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export async function fitImageToCap(
  uri: string,
  limitBytes: number,
  deps: FitImageDeps,
  steps: readonly ImageFitStep[] = IMAGE_FIT_STEPS,
): Promise<FitImageResult> {
  const original = await deps.byteSize(uri).catch(() => null);
  // Under the cap: send the member's own bytes. A GIF or PNG stays what it is.
  if (original !== null && original <= limitBytes) {
    return { ok: true, uri, bytes: original, reencoded: false };
  }

  let dims: { width: number; height: number };
  try {
    dims = await deps.dimensions(uri);
  } catch (e) {
    // Size unknown: let the server judge the original. Size known and over:
    // say why it can't be fixed here instead of failing the preflight later.
    if (original === null) return { ok: true, uri, bytes: null, reencoded: false };
    const reason = e instanceof Error && e.message ? ` (${e.message})` : "";
    return {
      ok: false,
      error: `That photo is ${mb(original)}MB and the limit is ${mb(limitBytes)}MB. It couldn't be resized here${reason}. Try a JPEG or PNG.`,
    };
  }

  let smallest: number | null = null;
  for (const step of steps) {
    const resize = scaleToFit(dims.width, dims.height, step.maxEdge);
    let out: string;
    try {
      out = await deps.encode(uri, resize, step.quality);
    } catch (e) {
      if (original === null) return { ok: true, uri, bytes: null, reencoded: false };
      const reason = e instanceof Error && e.message ? ` (${e.message})` : "";
      return {
        ok: false,
        error: `That photo is ${mb(original)}MB and the limit is ${mb(limitBytes)}MB. It couldn't be resized here${reason}. Try a JPEG or PNG.`,
      };
    }
    const bytes = await deps.byteSize(out).catch(() => null);
    if (bytes === null) return { ok: true, uri: out, bytes: null, reencoded: true };
    if (bytes <= limitBytes) return { ok: true, uri: out, bytes, reencoded: true };
    smallest = smallest === null ? bytes : Math.min(smallest, bytes);
  }

  return {
    ok: false,
    error: `That photo is still ${mb(smallest ?? original ?? 0)}MB after resizing, and the limit is ${mb(limitBytes)}MB. Try a different photo.`,
  };
}
