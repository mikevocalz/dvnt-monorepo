/**
 * Pick-time checks for video, using the limits media-upload enforces.
 *
 * Every number comes from upload-policy.ts, which its tests pin to the edge
 * function. Nothing here holds its own copy of a limit.
 */
import {
  ALLOWED_VIDEO_MIMES,
  MAX_VIDEO_DURATION_SEC,
  sizeLimitForKind,
} from "./upload-policy.ts";

const MB = 1024 * 1024;

export type VideoPickInput = {
  /** media-upload kind, e.g. "post-video". */
  kind: string;
  mimeType?: string | null;
  fileName?: string | null;
  sizeBytes?: number | null;
  durationSec?: number | null;
  /**
   * Native encodes an oversized clip down to the budget before upload, so size
   * is not a reason to refuse the pick there. Web uploads the file as picked.
   */
  canReencode?: boolean;
  /**
   * What to do when neither the type nor the file name says what the file is.
   * Web refuses (it would upload an untyped body). Native pickers sometimes
   * return neither, and the uploader names the container from the URI.
   */
  unknownFormat?: "reject" | "allow";
};

export type VideoPickResult =
  | { ok: true }
  | { ok: false; reason: "format" | "size" | "duration"; title: string; message: string };

const EXTENSION_MIMES: Record<string, string> = {
  mp4: "video/mp4",
  m4v: "video/mp4",
  mov: "video/quicktime",
  qt: "video/quicktime",
  webm: "video/webm",
  mkv: "video/x-matroska",
  avi: "video/x-msvideo",
  "3gp": "video/3gpp",
};

function resolveMime(mimeType?: string | null, fileName?: string | null): string | null {
  const declared = mimeType?.trim().toLowerCase();
  if (declared) return declared;
  const ext = fileName?.split(".").pop()?.toLowerCase();
  if (ext && fileName?.includes(".")) return EXTENSION_MIMES[ext] ?? `video/${ext}`;
  return null;
}

function surfaceLabel(kind: string): string {
  const [surface] = kind.split("-");
  if (surface === "post") return "Post";
  if (surface === "story") return "Story";
  if (surface === "message") return "Message";
  if (surface === "event") return "Event";
  return "";
}

const wholeMb = (bytes: number) => Math.round(bytes / MB);
const FORMAT_COPY = "That video format can't be posted. Use MP4 or MOV.";

export function validateVideoPick(input: VideoPickInput): VideoPickResult {
  const mime = resolveMime(input.mimeType, input.fileName);
  if (mime == null) {
    if (input.unknownFormat !== "allow") {
      return { ok: false, reason: "format", title: "Unsupported video", message: FORMAT_COPY };
    }
  } else if (!(ALLOWED_VIDEO_MIMES as readonly string[]).includes(mime)) {
    return { ok: false, reason: "format", title: "Unsupported video", message: FORMAT_COPY };
  }

  // Rounded like video-duration.web.ts: a 60s timeline exported at 60.2s is
  // not refused over a fraction the member cannot see. Unknown length passes
  // and the server reads it.
  const duration = input.durationSec;
  if (duration != null && Number.isFinite(duration) && Math.round(duration) > MAX_VIDEO_DURATION_SEC) {
    return {
      ok: false,
      reason: "duration",
      title: "Video too long",
      message: `That video is ${Math.round(duration)}s long. Videos can be up to ${MAX_VIDEO_DURATION_SEC}s.`,
    };
  }

  const limit = sizeLimitForKind(input.kind);
  const size = input.sizeBytes;
  if (!input.canReencode && size != null && Number.isFinite(size) && size > limit) {
    const surface = surfaceLabel(input.kind);
    return {
      ok: false,
      reason: "size",
      title: "Video too large",
      message: `That video is ${wholeMb(size)}MB. ${surface ? `${surface} videos` : "Videos"} can be up to ${wholeMb(limit)}MB.`,
    };
  }

  return { ok: true };
}

/** One line for the composer, e.g. "Video up to 60s, 25MB, MP4 or MOV". */
export function videoLimitsLabel(kind: string): string {
  return `Video up to ${MAX_VIDEO_DURATION_SEC}s, ${wholeMb(sizeLimitForKind(kind))}MB, MP4 or MOV`;
}

const FALLBACK = "Media upload failed. Try again.";

/**
 * media-upload answers with strings written for logs ("Invalid mime type for
 * post-video: video/webm. Allowed: ..."). Map the ones a member can act on to
 * plain copy; anything else is passed through, since the client-side messages
 * are already written for people.
 */
export function friendlyUploadError(raw: string | null | undefined): string {
  const message = raw?.trim();
  if (!message) return FALLBACK;

  if (/^Invalid mime type for [a-z-]*video/i.test(message)) return FORMAT_COPY;
  if (/^Invalid mime type for /i.test(message)) {
    return "That photo format can't be posted. Use JPEG, PNG, WebP, HEIC or GIF.";
  }

  const tooLarge = /^File too large for ([a-z-]+): ([\d.]+)MB exceeds ([\d.]+)MB limit/i.exec(message);
  if (tooLarge) {
    const [, kind, actual, limit] = tooLarge;
    const noun = kind.endsWith("video") ? "video" : "photo";
    const surface = surfaceLabel(kind);
    const plural = surface ? `${surface} ${noun}s` : `${noun[0].toUpperCase()}${noun.slice(1)}s`;
    return `That ${noun} is ${Math.round(Number(actual))}MB. ${plural} can be up to ${Math.round(Number(limit))}MB.`;
  }

  const tooLong = /(?:Video too long: |Duration )(\d+(?:\.\d+)?)s exceeds (\d+)s limit/i.exec(message);
  if (tooLong) {
    return `That video is ${Math.round(Number(tooLong[1]))}s long. Videos can be up to ${tooLong[2]}s.`;
  }

  return message;
}
