/**
 * Supabase Edge Function: media-upload
 *
 * Server-side media upload to Bunny CDN with validation.
 * Bunny credentials NEVER exposed to client.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { checkRateLimit, UPLOAD_LIMIT } from "../_shared/rate-limit.ts";

// Types
type MediaKind =
  | "avatar"
  | "post-image"
  | "post-video"
  | "story-image"
  | "story-video"
  | "event-cover"
  | "event-image"
  | "event-moment-photo"
  | "event-moment-video"
  | "event-video"
  | "message-image"
  | "message-video";

interface UploadRequest {
  kind: MediaKind;
  filename: string;
  mime: string;
  durationSec?: number;
  width?: number;
  height?: number;
}

interface MediaRecord {
  id: string;
  kind: string;
  url: string;
  key: string;
  mime: string;
  size: number;
  duration_sec: number | null;
  width: number | null;
  height: number | null;
}

// Constants
const ALLOWED_IMAGE_MIMES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/gif",
];
const ALLOWED_VIDEO_MIMES = ["video/mp4", "video/quicktime", "video/mov"];

/**
 * Byte ceilings. Videos are sized for an UNEDITED ORIGINAL, because that is
 * what the client now sends: the old 18/25 MB caps were sized for the 360x640
 * re-encode that used to happen on the phone, and a real 60s 1080p clip is
 * 60-90 MB.
 *
 * 96 MiB is not arbitrary. Video now streams through this function without
 * being buffered (see uploadToBunny), so the ceiling is about what a member
 * can actually get up a mobile connection inside the 150s request idle timeout
 * rather than about isolate memory: 96 MiB needs roughly 5 Mbps sustained.
 * Beyond that the honest answer is "that file is too big", which the client
 * says plainly instead of quietly re-encoding it.
 */
const SIZE_LIMITS: Record<MediaKind, number> = {
  avatar: 2 * 1024 * 1024, // 2 MB
  "post-image": 10 * 1024 * 1024, // 10 MB (GIFs can exceed 5MB)
  "post-video": 96 * 1024 * 1024, // an unedited 60s 1080p original
  "story-image": 5 * 1024 * 1024, // 5 MB
  "story-video": 96 * 1024 * 1024, // an unedited 60s 1080p original
  "event-cover": 5 * 1024 * 1024, // 5 MB
  "event-image": 5 * 1024 * 1024, // 5 MB
  "event-moment-photo": 10 * 1024 * 1024, // 10 MB
  "event-moment-video": 96 * 1024 * 1024,
  "event-video": 96 * 1024 * 1024, // event flyer/trailer, original
  "message-image": 5 * 1024 * 1024, // 5 MB
  "message-video": 64 * 1024 * 1024, // DM clip, original
};

const VIDEO_KINDS: MediaKind[] = ["post-video", "story-video", "message-video", "event-moment-video", "event-video"];
const IMAGE_KINDS: MediaKind[] = [
  "avatar",
  "post-image",
  "story-image",
  "event-cover",
  "event-image",
  "event-moment-photo",
  "message-image",
];
const MAX_VIDEO_DURATION_SEC = 60;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

// Helpers
function isVideoKind(kind: MediaKind): boolean {
  return VIDEO_KINDS.includes(kind);
}

function isImageKind(kind: MediaKind): boolean {
  return IMAGE_KINDS.includes(kind);
}

function getAllowedMimes(kind: MediaKind): string[] {
  if (isVideoKind(kind)) return ALLOWED_VIDEO_MIMES;
  return ALLOWED_IMAGE_MIMES;
}

function getExtFromMime(mime: string): string {
  const map: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/heic": "heic",
    "video/mp4": "mp4",
    "video/quicktime": "mov",
    "video/mov": "mov",
  };
  return map[mime] || "bin";
}

function generateKey(kind: MediaKind, userId: string, mime: string): string {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const uuid = crypto.randomUUID();
  const ext = getExtFromMime(mime);
  return `${kind}/${userId}/${year}/${month}/${uuid}.${ext}`;
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      // Browser (web) clients need this on the actual response, not just the
      // OPTIONS preflight, or the fetch is blocked even when the upload succeeds.
      "Access-Control-Allow-Origin": "*",
    },
  });
}

function errorResponse(message: string): Response {
  return jsonResponse({ ok: false, error: message }, 200);
}

/**
 * Pass-through that counts bytes and aborts the moment the limit is passed.
 *
 * Backpressure is preserved because TransformStream only pulls from the source
 * as the destination consumes — this never accumulates the file, and the only
 * memory held is the chunk in flight. An oversized body dies mid-transfer
 * instead of being measured after it has all arrived.
 */
function boundedCountingStream(
  source: ReadableStream<Uint8Array>,
  limit: number,
  onCount: (total: number) => void,
): ReadableStream<Uint8Array> {
  let total = 0;
  const counter = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      total += chunk.byteLength;
      if (limit && total > limit) {
        controller.error(
          new Error(
            `upload exceeded ${(limit / 1024 / 1024).toFixed(1)}MB while transferring`,
          ),
        );
        return;
      }
      onCount(total);
      controller.enqueue(chunk);
    },
    flush() {
      onCount(total);
    },
  });
  return source.pipeThrough(counter);
}

/**
 * Remove an object we are not going to reference. A failed or truncated upload
 * that stays in the zone is an orphan nothing will ever clean up, because the
 * key only exists in this function's local scope once the request ends.
 */
async function deleteStoredObject(
  host: string,
  zone: string,
  accessKey: string,
  key: string,
): Promise<void> {
  try {
    const resp = await fetch(`https://${host}/${zone}/${key}`, {
      method: "DELETE",
      headers: { AccessKey: accessKey },
      signal: AbortSignal.timeout(15_000),
    });
    console.log(`[media-upload] cleanup DELETE ${key} → ${resp.status}`);
  } catch (err) {
    console.error(`[media-upload] cleanup DELETE ${key} failed:`, err);
  }
}

// Main handler
Deno.serve(async (req) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    // Reflect whatever the browser asks for rather than maintaining a list.
    //
    // A hardcoded list kept failing this preflight one header at a time:
    // supabase-js injects `x-client-info`, and Sentry's tracing injects
    // `baggage` + `sentry-trace` into every outgoing fetch. Each omission
    // reads identically to the client — net::ERR_FAILED with no server log —
    // and any future SDK header would break it again. Reflection is safe
    // here: the function authorizes every request from the Better Auth
    // session token in the Authorization header, so allowing a header to be
    // SENT grants nothing on its own, and Allow-Origin:* means the browser
    // never attaches cookies.
    const requested = req.headers.get("Access-Control-Request-Headers");
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, DELETE, OPTIONS",
        "Access-Control-Allow-Headers":
          requested ??
          "Authorization, apikey, Content-Type, x-client-info, x-supabase-api-version, x-file-name, x-mime, x-kind, x-duration-sec, x-width, x-height, x-keys, x-blurhash",
        "Access-Control-Max-Age": "86400",
      },
    });
  }

  if (req.method !== "POST" && req.method !== "DELETE") {
    return errorResponse("Method not allowed");
  }

  // Get env vars (NEVER log these)
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const BUNNY_STORAGE_HOST =
    Deno.env.get("BUNNY_STORAGE_HOST") || "storage.bunnycdn.com";
  const BUNNY_STORAGE_ZONE = Deno.env.get("BUNNY_STORAGE_ZONE");
  const BUNNY_ACCESS_KEY = Deno.env.get("BUNNY_ACCESS_KEY");
  const BUNNY_PULLZONE_BASE_URL = Deno.env.get("BUNNY_PULLZONE_BASE_URL");

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error("[media-upload] Missing Supabase config");
    return errorResponse("Server configuration error");
  }

  if (!BUNNY_STORAGE_ZONE || !BUNNY_ACCESS_KEY || !BUNNY_PULLZONE_BASE_URL) {
    console.error("[media-upload] Missing Bunny config");
    return errorResponse("Server configuration error");
  }

  // Auth check — Better Auth session token
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      headers: { Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
    },
  });

  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.replace("Bearer ", "").trim();
  if (!token) {
    return errorResponse("Missing or invalid Authorization header");
  }

  // Verify Better Auth session via direct DB lookup
  const { data: session, error: sessionError } = await supabase
    .from("session")
    .select("userId, expiresAt")
    .eq("token", token)
    .single();

  if (sessionError || !session) {
    console.error("[media-upload] Session not found:", sessionError?.message);
    return errorResponse("Unauthorized");
  }

  if (new Date(session.expiresAt) < new Date()) {
    console.error("[media-upload] Session expired");
    return errorResponse("Unauthorized");
  }

  const userId = session.userId;

  // Rate limit check
  const rl = checkRateLimit(userId, "media-upload", UPLOAD_LIMIT);
  if (!rl.allowed) {
    return errorResponse("Too many uploads. Try again shortly.");
  }

  // ── DELETE handler ─────────────────────────────────────────────────
  if (req.method === "DELETE") {
    // Accept a JSON body with { keys: string[] } — each key is a Bunny storage path
    let keys: string[] = [];
    try {
      const body = await req.json();
      keys = Array.isArray(body.keys) ? body.keys : [];
    } catch {
      return errorResponse("Invalid JSON body — expected { keys: string[] }");
    }

    if (keys.length === 0) {
      return errorResponse("No keys provided");
    }
    if (keys.length > 50) {
      return errorResponse("Max 50 keys per request");
    }

    const results: { key: string; deleted: boolean }[] = [];

    for (const key of keys) {
      // Safety: keys must look like "kind/userId/..." — reject path traversal
      if (!key || key.includes("..") || key.startsWith("/")) {
        results.push({ key, deleted: false });
        continue;
      }

      try {
        const deleteUrl = `https://${BUNNY_STORAGE_HOST}/${BUNNY_STORAGE_ZONE}/${key}`;
        const resp = await fetch(deleteUrl, {
          method: "DELETE",
          headers: { AccessKey: BUNNY_ACCESS_KEY },
        });
        const ok = resp.status === 200 || resp.status === 404; // 404 = already gone
        results.push({ key, deleted: ok });
        console.log(`[media-upload] DELETE ${key} → ${resp.status}`);
      } catch (err) {
        console.error(`[media-upload] DELETE ${key} error:`, err);
        results.push({ key, deleted: false });
      }
    }

    return jsonResponse({ ok: true, results });
  }

  // ── POST handler (upload) ──────────────────────────────────────────
  // Parse request - support both multipart and raw bytes
  // Empty unless the buffered (image) path fills it; the streamed path leaves
  // it empty by design and reports its size from the counter instead.
  let fileBytes: Uint8Array = new Uint8Array(0);
  let kind: MediaKind;
  let filename: string;
  let mime: string;
  let durationSec: number | undefined;
  let width: number | undefined;
  let height: number | undefined;
  // Compact inline fade-in placeholder (base64 WebP micro-preview data URI)
  // generated client-side (server-upload.ts). Persisted to the historically-NULL
  // `blurhash` column so surfaces can fade images in with zero CLS.
  let blurhash: string | undefined;
  /** Set instead of `fileBytes` when the body is piped straight to storage. */
  let fileStream: ReadableStream<Uint8Array> | null = null;
  let streamLength = 0;
  /** Bytes actually forwarded. Set by the counting stream as it drains. */
  let streamedBytes = 0;

  const contentType = req.headers.get("Content-Type") || "";

  try {
    if (contentType.includes("multipart/form-data")) {
      // Multipart form data
      const formData = await req.formData();
      const file = formData.get("file") as File | null;
      const kindField = formData.get("kind") as string | null;

      if (!file || !kindField) {
        return errorResponse("Missing file or kind in form data");
      }

      kind = kindField as MediaKind;
      const limit = SIZE_LIMITS[kind];
      if (!limit) return errorResponse("Invalid media kind");
      if (file.size > limit) {
        return errorResponse(`File too large for ${kind}: ${(file.size / 1024 / 1024).toFixed(2)}MB exceeds ${(limit / 1024 / 1024).toFixed(1)}MB limit`);
      }
      fileBytes = new Uint8Array(await file.arrayBuffer());
      filename = file.name || "upload";
      mime = file.type || "application/octet-stream";

      // Expo's multipart upload may send application/octet-stream when the OS
      // can't determine mime from extension. Fall back to the explicit mime field.
      if (mime === "application/octet-stream") {
        const mimeField = formData.get("mime") as string | null;
        if (mimeField && mimeField !== "application/octet-stream") {
          mime = mimeField;
        }
      }

      const durationField = formData.get("durationSec");
      const widthField = formData.get("width");
      const heightField = formData.get("height");

      if (durationField) durationSec = parseInt(durationField as string, 10);
      if (widthField) width = parseInt(widthField as string, 10);
      if (heightField) height = parseInt(heightField as string, 10);

      // server-upload.ts sends the placeholder as a `blurhash` form field
      // (web + native). Optional + additive — absent on legacy clients.
      const blurhashField = formData.get("blurhash");
      if (typeof blurhashField === "string" && blurhashField.trim()) {
        blurhash = blurhashField.trim();
      }
    } else {
      // Raw bytes with headers
      const kindHeader = req.headers.get("x-kind");
      const filenameHeader = req.headers.get("x-file-name");
      const mimeHeader = req.headers.get("x-mime");
      const durationHeader = req.headers.get("x-duration-sec");
      const widthHeader = req.headers.get("x-width");
      const heightHeader = req.headers.get("x-height");

      if (!kindHeader || !filenameHeader || !mimeHeader) {
        return errorResponse(
          "Missing required headers: x-kind, x-file-name, x-mime",
        );
      }

      kind = kindHeader as MediaKind;
      filename = filenameHeader;
      mime = mimeHeader;

      if (durationHeader) durationSec = parseInt(durationHeader, 10);
      if (widthHeader) width = parseInt(widthHeader, 10);
      if (heightHeader) height = parseInt(heightHeader, 10);

      // Raw-bytes transport mirror of the multipart `blurhash` field.
      const blurhashHeader = req.headers.get("x-blurhash");
      if (blurhashHeader && blurhashHeader.trim()) {
        blurhash = blurhashHeader.trim();
      }

      // Video is streamed, not buffered. `req.arrayBuffer()` materialises the
      // whole file inside a 256MB isolate, which is what made a 96MB original
      // impossible regardless of what the size limit said. Images keep the
      // buffered path — they are small, and the blurhash/probe work wants the
      // bytes in hand anyway.
      const declaredLength = Number(
        req.headers.get("x-content-length") ||
          req.headers.get("Content-Length") ||
          0,
      );
      if (isVideoKind(kind)) {
        // A video without a usable declared length must NOT fall through to
        // req.arrayBuffer(): that is the unbounded path this function is
        // supposed to have stopped using, and it is reachable by anyone who
        // omits a header.
        if (!req.body || !Number.isFinite(declaredLength) || declaredLength <= 0) {
          return errorResponse(
            "Missing or invalid x-content-length for a video upload",
          );
        }
        const limit = SIZE_LIMITS[kind];
        if (limit && declaredLength > limit) {
          return errorResponse(
            `File too large for ${kind}: ${(declaredLength / 1024 / 1024).toFixed(2)}MB exceeds ${(limit / 1024 / 1024).toFixed(1)}MB limit`,
          );
        }
        // The declared length is a claim by the caller — on web it cannot even
        // be the real Content-Length, since browsers forbid setting that
        // header. Count what actually arrives and fail the transfer the moment
        // it exceeds the limit, rather than trusting the number and finding
        // out afterwards.
        fileStream = boundedCountingStream(req.body, limit, (n) => {
          streamedBytes = n;
        });
        streamLength = declaredLength;
      } else {
        fileBytes = new Uint8Array(await req.arrayBuffer());
      }
    }
  } catch (parseError) {
    console.error("[media-upload] Parse error:", parseError);
    return errorResponse("Failed to parse request body");
  }

  // Validate kind
  const validKinds: MediaKind[] = [...IMAGE_KINDS, ...VIDEO_KINDS];
  if (!validKinds.includes(kind)) {
    return errorResponse(
      `Invalid kind: ${kind}. Allowed: ${validKinds.join(", ")}`,
    );
  }

  // Validate mime
  const allowedMimes = getAllowedMimes(kind);
  if (!allowedMimes.includes(mime)) {
    return errorResponse(
      `Invalid mime type for ${kind}: ${mime}. Allowed: ${allowedMimes.join(", ")}`,
    );
  }

  // Validate size. A streamed body was already checked against the declared
  // Content-Length before a byte was piped — checking `fileBytes` here would
  // read 0 and reject every streamed upload as empty.
  const sizeLimit = SIZE_LIMITS[kind];
  const declaredSize = fileStream ? streamLength : fileBytes.length;
  if (declaredSize === 0) {
    return errorResponse("Empty file");
  }
  if (declaredSize > sizeLimit) {
    const limitMB = (sizeLimit / (1024 * 1024)).toFixed(1);
    const actualMB = (declaredSize / (1024 * 1024)).toFixed(2);
    return errorResponse(
      `File too large for ${kind}: ${actualMB}MB exceeds ${limitMB}MB limit`,
    );
  }

  // Validate video duration (if provided — client validates before upload)
  if (isVideoKind(kind) && durationSec !== undefined && !isNaN(durationSec)) {
    if (durationSec > MAX_VIDEO_DURATION_SEC) {
      return errorResponse(
        `Video too long: ${durationSec}s exceeds ${MAX_VIDEO_DURATION_SEC}s limit`,
      );
    }
  }

  // Generate storage key
  const key = generateKey(kind, userId, mime);
  const uploadUrl = `https://${BUNNY_STORAGE_HOST}/${BUNNY_STORAGE_ZONE}/${key}`;
  const publicUrl = `${BUNNY_PULLZONE_BASE_URL}/${key}`;

  // Upload to Bunny with retries
  let uploadSuccess = false;
  let lastError = "";

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      console.log(
        `[media-upload] Attempt ${attempt}/${MAX_RETRIES} uploading to Bunny: ${key}`,
      );

      // A stream can only be consumed once, so a streamed upload gets one
      // attempt — the retry loop below still covers the buffered (image) path.
      // Content-Length is sent explicitly in both cases: Bunny Storage sizes
      // the object from it, and a chunked PUT without it is not worth risking
      // on a member's only copy.
      const streaming = fileStream !== null;
      if (streaming && attempt > 1) {
        lastError =
          "upload stream already consumed — cannot retry a streamed body";
        break;
      }

      const response = await fetch(uploadUrl, {
        method: "PUT",
        headers: {
          AccessKey: BUNNY_ACCESS_KEY,
          "Content-Type": mime,
          "Content-Length": String(streaming ? streamLength : fileBytes.length),
        },
        body: streaming
          ? (fileStream as unknown as BodyInit)
          : (fileBytes as unknown as BodyInit),
        // A 96MB original on a slow connection needs more than the 45s that
        // was sized for a 4MB re-encode.
        signal: AbortSignal.timeout(streaming ? 120_000 : 45_000),
        // Deno needs this to send a stream body at all.
        ...(streaming ? { duplex: "half" } : {}),
      } as RequestInit);

      if (response.status === 201 || response.status === 200) {
        // Bunny accepted it — now check that what we forwarded is what the
        // caller said they were sending. A truncated body (dropped connection,
        // a client that lied about the length) otherwise lands as a short,
        // unplayable object that the DB row describes as complete.
        if (streaming && streamedBytes !== streamLength) {
          lastError =
            `truncated upload: forwarded ${streamedBytes} bytes, declared ${streamLength}`;
          console.error(`[media-upload] ${lastError} — deleting ${key}`);
          await deleteStoredObject(
            BUNNY_STORAGE_HOST,
            BUNNY_STORAGE_ZONE,
            BUNNY_ACCESS_KEY,
            key,
          );
          break;
        }
        uploadSuccess = true;
        console.log(`[media-upload] Upload successful: ${key}`);
        break;
      }

      // Don't retry 4xx errors (client errors)
      if (response.status >= 400 && response.status < 500) {
        const body = await response.text();
        lastError = `Bunny returned ${response.status}: ${body}`;
        console.error(`[media-upload] Bunny client error: ${lastError}`);
        break;
      }

      // Retry on 5xx errors
      lastError = `Bunny returned ${response.status}`;
      console.warn(
        `[media-upload] Bunny server error, will retry: ${lastError}`,
      );

      if (attempt < MAX_RETRIES) {
        await sleep(RETRY_DELAY_MS * attempt);
      }
    } catch (networkError) {
      lastError =
        networkError instanceof Error
          ? networkError.message
          : String(networkError);
      console.warn(`[media-upload] Network error, will retry: ${lastError}`);

      if (attempt < MAX_RETRIES) {
        await sleep(RETRY_DELAY_MS * attempt);
      }
    }
  }

  if (!uploadSuccess) {
    console.error(
      `[media-upload] Upload failed after ${MAX_RETRIES} attempts: ${lastError}`,
    );
    return errorResponse(`Upload failed: ${lastError}`);
  }

  // Insert media record into database using existing schema
  const mediaRecord = {
    url: publicUrl,
    filename: key,
    mime_type: mime,
    // What was actually forwarded and accepted — not what the caller claimed.
    filesize: fileStream ? streamedBytes : fileBytes.length,
    width: width || null,
    height: height || null,
    type: isVideoKind(kind) ? "video" : "image",
    // Additive: NULL when the client didn't send one (legacy clients, videos,
    // or failed generation). Backfills the historically-NULL `blurhash` column.
    blurhash: blurhash || null,
  };

  const { data: insertedMedia, error: insertError } = await supabase
    .from("media")
    .insert(mediaRecord)
    .select()
    .single();

  if (insertError) {
    console.error(
      "[media-upload] DB insert error:",
      insertError.message,
      insertError.code,
      insertError.details,
    );
    // The object is in the zone and nothing will ever reference it — the key
    // lives only in this request. Remove it rather than leave an orphan that
    // bills storage forever and appears in no listing anyone reads.
    await deleteStoredObject(
      BUNNY_STORAGE_HOST,
      BUNNY_STORAGE_ZONE,
      BUNNY_ACCESS_KEY,
      key,
    );
    return errorResponse(`Failed to save media record: ${insertError.message}`);
  }

  // Return success using existing schema column names
  console.log(
    `[media-upload] Success: ${insertedMedia.id} -> ${insertedMedia.url}`,
  );

  return jsonResponse({
    ok: true,
    media: {
      id: insertedMedia.id,
      kind: kind,
      url: insertedMedia.url,
      key: insertedMedia.filename,
      mime: insertedMedia.mime_type,
      size: insertedMedia.filesize,
      durationSec: isVideoKind(kind) ? durationSec : null,
      width: insertedMedia.width,
      height: insertedMedia.height,
    },
  });
});
