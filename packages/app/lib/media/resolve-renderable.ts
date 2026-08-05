/**
 * Render-side media resolver — the single answer to "what do I actually put on
 * screen for this media row?"
 *
 * `detect-media-kind.ts` is the UPLOAD-side counterpart (picker asset → kind).
 * This is its mirror: a row that is already in the database → something safe to
 * render. Thumbnail bugs in this codebase have all been the same shape, solved
 * once per surface: 81 files reference "thumbnail", each deciding for itself
 * whether a URL is safe for an <img>. This exists so that decision is made in
 * exactly one place.
 *
 * THE GUARANTEE: `posterUrl` is never a video URL. Putting an .mp4/.mov in an
 * <img> is what produces the broken-image glyph, and it is structurally
 * impossible to get one out of this function. If there is no real poster, you
 * get `null` and must render your own placeholder (or the <video> itself).
 *
 * Ground truth from production (1350 media rows, 2026-08-05):
 *   - EVERY thumbnail column is NULL: thumbnail_u_r_l, sizes_thumbnail_url,
 *     sizes_card_url, blurhash. There are no stored thumbnails at all, so
 *     `posterUrl` for a video is legitimately null until posters are generated.
 *   - 16 rows are typed `image` but carry mime_type `video/mp4`. Trusting the
 *     `type` column alone renders those into an <img> and they break. MIME and
 *     extension are therefore checked BEFORE `type`.
 *   - 42 videos are video/quicktime and 39 images are image/heic — iPhone Live
 *     Photo output. Neither decodes in Chrome/Firefox/Edge (Safari only), which
 *     is why they read as "missing" rather than "broken". They are reported via
 *     `browserUnsupported` so a surface can show an honest placeholder instead
 *     of an infinite spinner or a dead <img>.
 *   - Bunny Optimizer is NOT enabled on the dvnt.b-cdn.net pull zone: `?width=`
 *     returns the byte-identical original. So there is no free derived
 *     thumbnail, and this resolver never fabricates one from a query param.
 *     (An earlier backfill did exactly that with `?thumb=true` and produced
 *     "thumbnails" that were the full video file.)
 */

export type RenderableKind = "image" | "video";

export interface MediaLike {
  /** `media.url` — the original asset. */
  url?: string | null;
  /** `media.type` enum. Advisory only: 16 prod rows disagree with their MIME. */
  type?: string | null;
  /** `media.mime_type` — the most reliable signal when present. */
  mimeType?: string | null;
  /** `media.thumbnail_u_r_l` / `sizes_thumbnail_url` — a REAL stored poster. */
  thumbnailUrl?: string | null;
  /** `media.filename` — extension fallback when MIME is null (162 prod rows). */
  filename?: string | null;
}

export interface RenderableMedia {
  kind: RenderableKind;
  /**
   * Safe for `<img src>` / expo-image. Never a video URL. Null when no poster
   * exists — render a placeholder, do NOT fall back to `url`.
   */
  posterUrl: string | null;
  /** Safe for `<video src>`. Null unless `kind === "video"`. */
  videoUrl: string | null;
  /**
   * The format cannot be decoded by Chrome/Firefox/Edge (HEIC/HEIF, QuickTime).
   * Safari handles both; native handles both. Surfaces should show an explicit
   * "unsupported format" state rather than a spinner that never resolves.
   */
  browserUnsupported: boolean;
  /** Machine-readable reason, for logging/telemetry. */
  reason:
    | "ok"
    | "no_source"
    | "video_without_poster"
    | "heic_image"
    | "quicktime_video";
}

const VIDEO_MIMES = [
  "video/mp4",
  "video/quicktime",
  "video/x-m4v",
  "video/webm",
  "video/avi",
  "video/x-msvideo",
];
const VIDEO_EXTENSIONS = [".mp4", ".mov", ".m4v", ".webm", ".avi"];

/** Formats no non-Safari browser can decode. */
const BROWSER_UNSUPPORTED_IMAGE_MIMES = ["image/heic", "image/heif"];
const BROWSER_UNSUPPORTED_IMAGE_EXTENSIONS = [".heic", ".heif"];
const BROWSER_UNSUPPORTED_VIDEO_MIMES = ["video/quicktime"];
const BROWSER_UNSUPPORTED_VIDEO_EXTENSIONS = [".mov"];

/** Extension of a URL or filename, lowercased, query/hash stripped. */
function extensionOf(value?: string | null): string {
  if (!value) return "";
  const clean = value.split("?")[0].split("#")[0];
  const dot = clean.lastIndexOf(".");
  if (dot < 0 || dot < clean.lastIndexOf("/")) return "";
  return clean.slice(dot).toLowerCase();
}

function looksLikeVideo(mime: string, ext: string): boolean {
  if (mime.startsWith("video/")) return true;
  if (VIDEO_MIMES.includes(mime)) return true;
  return VIDEO_EXTENSIONS.includes(ext);
}

/**
 * Resolve a stored media row into something renderable.
 *
 * Detection order is deliberate: MIME → extension → `type` column. The `type`
 * column is checked LAST because production contains rows where it is wrong,
 * and trusting it first is what puts an mp4 into an <img>.
 */
export function resolveRenderableMedia(media: MediaLike): RenderableMedia {
  const url = media.url?.trim() || null;
  const storedPoster = media.thumbnailUrl?.trim() || null;
  const mime = (media.mimeType ?? "").toLowerCase().trim();
  const ext = extensionOf(media.filename) || extensionOf(url);

  // A stored poster is only trustworthy if it is not itself a video. An earlier
  // backfill wrote video URLs into the thumbnail slot, so this is validated
  // rather than assumed — old rows must not be able to reintroduce the bug.
  const posterIsVideo = storedPoster
    ? looksLikeVideo("", extensionOf(storedPoster))
    : false;
  const safePoster = storedPoster && !posterIsVideo ? storedPoster : null;

  if (!url && !safePoster) {
    return {
      kind: "image",
      posterUrl: null,
      videoUrl: null,
      browserUnsupported: false,
      reason: "no_source",
    };
  }

  const isVideo =
    looksLikeVideo(mime, ext) ||
    // `type` consulted only when MIME and extension are both silent.
    (!mime && !ext && (media.type ?? "").toLowerCase() === "video");

  if (isVideo) {
    const unsupported =
      BROWSER_UNSUPPORTED_VIDEO_MIMES.includes(mime) ||
      BROWSER_UNSUPPORTED_VIDEO_EXTENSIONS.includes(ext);
    return {
      kind: "video",
      // Only a real stored poster. Never `url` — that is the whole point.
      posterUrl: safePoster,
      videoUrl: url,
      browserUnsupported: unsupported,
      reason: unsupported
        ? "quicktime_video"
        : safePoster
          ? "ok"
          : "video_without_poster",
    };
  }

  const heic =
    BROWSER_UNSUPPORTED_IMAGE_MIMES.includes(mime) ||
    BROWSER_UNSUPPORTED_IMAGE_EXTENSIONS.includes(ext);

  return {
    kind: "image",
    posterUrl: safePoster ?? url,
    videoUrl: null,
    browserUnsupported: heic,
    reason: heic ? "heic_image" : "ok",
  };
}

/**
 * Convenience for the common "I just need a URL for an <img>" call site.
 * Returns null rather than anything unrenderable — callers render their own
 * placeholder. Never returns a video URL.
 */
export function resolvePosterUrl(media: MediaLike): string | null {
  const resolved = resolveRenderableMedia(media);
  if (resolved.browserUnsupported && resolved.kind === "image") return null;
  return resolved.posterUrl;
}

/** True when the surface must render its own placeholder. */
export function needsPlaceholder(media: MediaLike): boolean {
  return resolvePosterUrl(media) === null;
}
