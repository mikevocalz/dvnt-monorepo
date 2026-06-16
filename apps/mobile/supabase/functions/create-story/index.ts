/**
 * Edge Function: create-story
 * Create a new story with media URL (already uploaded to Bunny CDN)
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveOrProvisionUser } from "../_shared/resolve-user.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface ApiResponse<T = unknown> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

function jsonResponse<T>(data: ApiResponse<T>, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function errorResponse(
  code: string,
  message: string,
  _status?: number,
): Response {
  console.error(`[Edge:create-story] Error: ${code} - ${message}`);
  // Always return 200 — supabase.functions.invoke throws on non-2xx
  // before the client can read the JSON body. Errors are signaled via ok:false.
  return jsonResponse({ ok: false, error: { code, message } }, 200);
}

interface CreateStoryBody {
  mediaUrl: string;
  mediaType: "image" | "video";
  visibility?: "public" | "followers" | "close_friends";
  duration?: number;
  mediaKey?: string;
  thumbnailUrl?: string;
  thumbnailKey?: string;
  storyOverlays?: Array<{
    id?: string;
    type: "animated_gif" | "emoji" | "text" | "sticker";
    url?: string;
    assetId?: string;
    source?: "asset" | "url";
    emoji?: string;
    content?: string;
    color?: string;
    backgroundColor?: string;
    fontFamily?: string;
    fontSizeRatio?: number;
    maxWidthRatio?: number;
    textAlign?: "left" | "center" | "right";
    x: number;
    y: number;
    sizeRatio?: number;
    scale?: number;
    rotation?: number;
    opacity?: number;
  }>;
  animatedGifOverlays?: Array<{
    id?: string;
    url: string;
    x: number;
    y: number;
    sizeRatio: number;
    scale?: number;
    rotation?: number;
  }>;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return errorResponse("validation_error", "Method not allowed");
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return errorResponse(
        "unauthorized",
        "Missing or invalid Authorization header",
        401,
      );
    }

    const token = authHeader.replace("Bearer ", "");

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !supabaseServiceKey) {
      return errorResponse("internal_error", "Server configuration error");
    }
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${supabaseServiceKey}` } },
    });

    // Verify Better Auth session via direct DB lookup
    const { data: sessionData, error: sessionError } = await supabaseAdmin
      .from("session")
      .select("id, token, userId, expiresAt")
      .eq("token", token)
      .single();

    if (sessionError || !sessionData) {
      return errorResponse("unauthorized", "Invalid or expired session");
    }
    if (new Date(sessionData.expiresAt) < new Date()) {
      return errorResponse("unauthorized", "Session expired");
    }

    const authUserId = sessionData.userId;

    let body: CreateStoryBody;
    try {
      body = await req.json();
    } catch {
      return errorResponse("validation_error", "Invalid JSON body");
    }

    const {
      mediaUrl,
      mediaType,
      visibility,
      duration,
      mediaKey,
      thumbnailUrl,
      thumbnailKey,
      storyOverlays,
      animatedGifOverlays,
    } = body;

    if (!mediaUrl || typeof mediaUrl !== "string") {
      return errorResponse("validation_error", "mediaUrl is required");
    }

    if (!mediaType || !["image", "video"].includes(mediaType)) {
      return errorResponse(
        "validation_error",
        "mediaType must be 'image' or 'video'",
        400,
      );
    }

    // Get user's integer ID (auto-provision if needed)
    const userData = await resolveOrProvisionUser(
      supabaseAdmin,
      authUserId,
      "id, username, first_name, avatar:avatar_id(url)",
    );
    if (!userData) return errorResponse("not_found", "User not found");

    const userId = userData.id;
    console.log("[Edge:create-story] User:", userId);

    // Create media record first — upsert on filename to handle retries
    // (previous attempt may have inserted the media row but failed on the story row,
    // leaving an orphan that causes "duplicate key violates unique constraint media_filename_idx")
    const mediaPayload = {
      url: mediaUrl,
      type: mediaType,
      ...(mediaKey ? { filename: mediaKey } : {}),
      mime_type: mediaType === "video" ? "video/mp4" : "image/jpeg",
    };
    const mediaQuery = mediaKey
      ? supabaseAdmin
          .from("media")
          .upsert(mediaPayload, { onConflict: "filename" })
          .select()
          .single()
      : supabaseAdmin.from("media").insert(mediaPayload).select().single();
    const { data: mediaRecord, error: mediaError } = await mediaQuery;

    if (mediaError) {
      console.error(
        "[Edge:create-story] Media insert error:",
        JSON.stringify({
          message: mediaError.message,
          code: mediaError.code,
          details: mediaError.details,
          hint: mediaError.hint,
        }),
      );
      return errorResponse(
        "internal_error",
        `Failed to create media record: ${mediaError.message} (code: ${mediaError.code})`,
      );
    }

    // Calculate expiry (24 hours from now)
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 24);

    // Create thumbnail media record if provided (for video stories)
    let thumbnailMediaId: number | null = null;
    if (thumbnailUrl) {
      const thumbPayload = {
        url: thumbnailUrl,
        type: "image",
        ...(thumbnailKey ? { filename: thumbnailKey } : {}),
        mime_type: "image/jpeg",
      };
      const thumbQuery = thumbnailKey
        ? supabaseAdmin
            .from("media")
            .upsert(thumbPayload, { onConflict: "filename" })
            .select()
            .single()
        : supabaseAdmin.from("media").insert(thumbPayload).select().single();
      const { data: thumbRecord, error: thumbError } = await thumbQuery;

      if (!thumbError && thumbRecord) {
        thumbnailMediaId = thumbRecord.id;
        console.log(
          "[Edge:create-story] Thumbnail media created:",
          thumbnailMediaId,
        );
      }
    }

    // Create story
    const storyInsert: Record<string, unknown> = {
      author_id: authUserId,
      media_id: mediaRecord.id,
      expires_at: expiresAt.toISOString(),
      visibility: visibility || "public",
    };
    if (thumbnailMediaId) {
      storyInsert.thumbnail_id = thumbnailMediaId;
    }

    const { data: story, error: storyError } = await supabaseAdmin
      .from("stories")
      .insert(storyInsert)
      .select()
      .single();

    if (storyError) {
      console.error("[Edge:create-story] Story insert error:", storyError);
      return errorResponse("internal_error", "Failed to create story");
    }

    console.log("[Edge:create-story] Story created:", story.id);

    const normalizedLegacyAnimatedOverlays = Array.isArray(animatedGifOverlays)
      ? animatedGifOverlays
          .filter(
            (overlay) =>
              overlay &&
              typeof overlay.url === "string" &&
              overlay.url.length > 0,
          )
          .map((overlay) => ({
            id: overlay.id,
            type: "animated_gif" as const,
            url: overlay.url,
            x: overlay.x,
            y: overlay.y,
            sizeRatio: overlay.sizeRatio,
            scale: overlay.scale ?? 1,
            rotation: overlay.rotation ?? 0,
            opacity: 1,
          }))
      : [];

    const normalizedStoryOverlays = Array.isArray(storyOverlays)
      ? storyOverlays.filter((overlay) => {
          if (!overlay || typeof overlay.type !== "string") return false;
          if (overlay.type === "animated_gif") {
            return typeof overlay.url === "string" && overlay.url.length > 0;
          }
          if (overlay.type === "emoji") {
            return typeof overlay.emoji === "string" && overlay.emoji.length > 0;
          }
          if (overlay.type === "text") {
            return (
              typeof overlay.content === "string" && overlay.content.length > 0
            );
          }
          if (overlay.type === "sticker") {
            return (
              (overlay.source === "asset" &&
                typeof overlay.assetId === "string" &&
                overlay.assetId.length > 0) ||
              (overlay.source !== "asset" &&
                typeof overlay.url === "string" &&
                overlay.url.length > 0)
            );
          }
          return false;
        })
      : [];

    const normalizedOverlays =
      normalizedStoryOverlays.length > 0
        ? normalizedStoryOverlays
        : normalizedLegacyAnimatedOverlays;

    if (normalizedOverlays.length > 0) {
      const stickerRows = normalizedOverlays.map((overlay, index) => ({
        _order: index,
        _parent_id: story.id,
        id:
          typeof overlay.id === "string" && overlay.id.length > 0
            ? overlay.id
            : crypto.randomUUID(),
        type: overlay.type,
        data:
          overlay.type === "animated_gif"
            ? {
                url: overlay.url,
                x: overlay.x,
                y: overlay.y,
                sizeRatio: overlay.sizeRatio,
                scale: overlay.scale ?? 1,
                rotation: overlay.rotation ?? 0,
                opacity: overlay.opacity ?? 1,
              }
            : overlay.type === "emoji"
              ? {
                  emoji: overlay.emoji,
                  x: overlay.x,
                  y: overlay.y,
                  sizeRatio: overlay.sizeRatio ?? 0.18,
                  scale: overlay.scale ?? 1,
                  rotation: overlay.rotation ?? 0,
                  opacity: overlay.opacity ?? 1,
                }
              : overlay.type === "text"
                ? {
                    content: overlay.content,
                    x: overlay.x,
                    y: overlay.y,
                    scale: overlay.scale ?? 1,
                    rotation: overlay.rotation ?? 0,
                    opacity: overlay.opacity ?? 1,
                    color: overlay.color ?? "#FFFFFF",
                    backgroundColor: overlay.backgroundColor,
                    fontFamily: overlay.fontFamily,
                    fontSizeRatio: overlay.fontSizeRatio ?? 0.11,
                    maxWidthRatio: overlay.maxWidthRatio ?? 0.8,
                    textAlign: overlay.textAlign ?? "center",
                  }
                : {
                    source: overlay.source === "asset" ? "asset" : "url",
                    assetId:
                      overlay.source === "asset" ? overlay.assetId : undefined,
                    url: overlay.source === "asset" ? undefined : overlay.url,
                    x: overlay.x,
                    y: overlay.y,
                    sizeRatio: overlay.sizeRatio ?? 0.2,
                    scale: overlay.scale ?? 1,
                    rotation: overlay.rotation ?? 0,
                    opacity: overlay.opacity ?? 1,
                  },
      }));

      const { error: stickerError } = await supabaseAdmin
        .from("stories_stickers")
        .insert(stickerRows);

      if (stickerError) {
        console.error(
          "[Edge:create-story] Animated sticker insert error:",
          stickerError,
        );
        await supabaseAdmin.from("stories").delete().eq("id", story.id);
        return errorResponse(
          "internal_error",
          "Failed to save animated story overlays",
        );
      }
    }

    return jsonResponse({
      ok: true,
      data: {
        story: {
          id: String(story.id),
          authorId: String(userId),
          mediaUrl: mediaUrl,
          mediaType: mediaType,
          expiresAt: story.expires_at,
          visibility: story.visibility,
          createdAt: story.created_at,
          author: {
            id: String(userData.id),
            username: userData.username,
            name: userData.first_name || userData.username,
            avatar: (userData.avatar as any)?.url || null,
          },
        },
      },
    });
  } catch (err) {
    console.error("[Edge:create-story] Unexpected error:", err);
    return errorResponse("internal_error", "An unexpected error occurred");
  }
});
