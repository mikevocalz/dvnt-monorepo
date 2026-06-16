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

const SIZE_LIMITS: Record<MediaKind, number> = {
  avatar: 2 * 1024 * 1024, // 2 MB
  "post-image": 10 * 1024 * 1024, // 10 MB (GIFs can exceed 5MB)
  "post-video": 25 * 1024 * 1024, // 25 MB
  "story-image": 5 * 1024 * 1024, // 5 MB
  "story-video": 18 * 1024 * 1024, // 18 MB
  "event-cover": 5 * 1024 * 1024, // 5 MB
  "event-image": 5 * 1024 * 1024, // 5 MB
  "event-moment-photo": 10 * 1024 * 1024, // 10 MB
  "event-moment-video": 50 * 1024 * 1024, // 50 MB (30s max)
  "message-image": 5 * 1024 * 1024, // 5 MB
  "message-video": 12 * 1024 * 1024, // 12 MB
};

const VIDEO_KINDS: MediaKind[] = ["post-video", "story-video", "message-video", "event-moment-video"];
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
    headers: { "Content-Type": "application/json" },
  });
}

function errorResponse(message: string): Response {
  return jsonResponse({ ok: false, error: message }, 200);
}

// Main handler
Deno.serve(async (req) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, DELETE, OPTIONS",
        "Access-Control-Allow-Headers":
          "Authorization, Content-Type, x-file-name, x-mime, x-kind, x-duration-sec, x-width, x-height, x-keys",
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
  let fileBytes: Uint8Array;
  let kind: MediaKind;
  let filename: string;
  let mime: string;
  let durationSec: number | undefined;
  let width: number | undefined;
  let height: number | undefined;

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

      fileBytes = new Uint8Array(await file.arrayBuffer());
      kind = kindField as MediaKind;
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

      fileBytes = new Uint8Array(await req.arrayBuffer());
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

  // Validate size
  const sizeLimit = SIZE_LIMITS[kind];
  if (fileBytes.length === 0) {
    return errorResponse("Empty file");
  }
  if (fileBytes.length > sizeLimit) {
    const limitMB = (sizeLimit / (1024 * 1024)).toFixed(1);
    const actualMB = (fileBytes.length / (1024 * 1024)).toFixed(2);
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

      const response = await fetch(uploadUrl, {
        method: "PUT",
        headers: {
          AccessKey: BUNNY_ACCESS_KEY,
          "Content-Type": mime,
          "Content-Length": String(fileBytes.length),
        },
        body: fileBytes as unknown as BodyInit,
      });

      if (response.status === 201 || response.status === 200) {
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
    filesize: fileBytes.length,
    width: width || null,
    height: height || null,
    type: isVideoKind(kind) ? "video" : "image",
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
    // TODO: Consider deleting the uploaded file from Bunny on DB failure
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
