/**
 * Edge Function: create-post
 * Create a new post with media URLs (already uploaded to Bunny CDN)
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

function errorResponse(code: string, message: string, status = 200): Response {
  console.error(`[Edge:create-post] Error: ${code} - ${message}`);
  return jsonResponse({ ok: false, error: { code, message } }, status);
}

interface MediaItem {
  type: "image" | "video" | "gif" | "livePhoto";
  url: string;
  thumbnail?: string;
  mimeType?: string;
  livePhotoVideoUrl?: string;
}

interface CreatePostBody {
  content?: string;
  kind?: "media" | "text";
  textTheme?: "graphite" | "cobalt" | "ember" | "sage";
  slides?: string[];
  location?: string;
  isNSFW?: boolean;
  visibility?: "public" | "followers" | "private";
  media?: MediaItem[];
}

const TEXT_POST_MAX_SLIDES = 6;
const TEXT_POST_MAX_LENGTH = 2000;
const RECENT_DUPLICATE_WINDOW_MS = 90_000;

function normalizeLocation(value?: string | null): string | null {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized.length > 0 ? normalized : null;
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

    let body: CreatePostBody;
    try {
      body = await req.json();
    } catch {
      return errorResponse("validation_error", "Invalid JSON body");
    }

    const {
      content,
      kind,
      textTheme,
      slides,
      location,
      isNSFW,
      visibility,
      media,
    } = body;
    const postKind = kind === "text" ? "text" : "media";
    const normalizedLocationValue = normalizeLocation(location);
    const normalizedVisibility = visibility || "public";
    const normalizedIsNsfw = Boolean(isNSFW);
    const normalizedTheme =
      textTheme && ["graphite", "cobalt", "ember", "sage"].includes(textTheme)
        ? textTheme
        : "graphite";
    const normalizedSlides =
      postKind === "text"
        ? (Array.isArray(slides) && slides.length > 0
            ? slides
            : [content || ""]
          )
            .map((slide) => (typeof slide === "string" ? slide.trim() : ""))
            .filter((slide) => slide.length > 0)
        : [];

    if (postKind === "text" && normalizedSlides.length === 0) {
      return errorResponse(
        "validation_error",
        "Text posts require content",
        400,
      );
    }

    if (postKind === "text" && normalizedSlides.length > TEXT_POST_MAX_SLIDES) {
      return errorResponse(
        "validation_error",
        `Text posts support up to ${TEXT_POST_MAX_SLIDES} slides`,
        400,
      );
    }

    if (
      postKind === "text" &&
      normalizedSlides.some((slide) => slide.length > TEXT_POST_MAX_LENGTH)
    ) {
      return errorResponse(
        "validation_error",
        `Text posts must be ${TEXT_POST_MAX_LENGTH} characters or fewer`,
        400,
      );
    }

    if (
      postKind === "media" &&
      (!media || !Array.isArray(media) || media.length === 0)
    ) {
      return errorResponse(
        "validation_error",
        "Post must include at least one photo or video",
        400,
      );
    }

    // Validate each media item has a valid URL
    for (const m of media || []) {
      if (!m.url || typeof m.url !== "string" || !m.url.startsWith("http")) {
        return errorResponse(
          "validation_error",
          "Each media item must have a valid URL",
          400,
        );
      }
      if (!["image", "video", "gif", "livePhoto"].includes(m.type)) {
        return errorResponse(
          "validation_error",
          "Each media item must have a supported media type",
          400,
        );
      }
    }

    // Get user's integer ID and profile info (auto-provision if needed)
    const userData = await resolveOrProvisionUser(
      supabaseAdmin,
      authUserId,
      "id, username, first_name, avatar:avatar_id(url)",
    );
    if (!userData) return errorResponse("not_found", "User not found");

    const userId = userData.id;
    console.log("[Edge:create-post] User:", userId);
    const normalizedContent =
      postKind === "text" ? normalizedSlides[0] || "" : content?.trim() || "";
    let post: any = null;

    if (postKind === "text") {
      const { data: createPostRows, error: createPostError } =
        await supabaseAdmin.rpc("create_post_with_dedupe", {
          p_author_id: userId,
          p_content: normalizedContent,
          p_post_kind: postKind,
          p_text_theme: normalizedTheme,
          p_location: normalizedLocationValue,
          p_is_nsfw: normalizedIsNsfw,
          p_visibility: normalizedVisibility,
          p_slides: normalizedSlides,
          p_media: [],
          p_recent_window_seconds: Math.floor(
            RECENT_DUPLICATE_WINDOW_MS / 1000,
          ),
        });

      if (createPostError) {
        console.error(
          "[Edge:create-post] Atomic text create error:",
          createPostError,
        );
        return errorResponse("internal_error", "Failed to create post");
      }

      post = Array.isArray(createPostRows)
        ? createPostRows[0]
        : createPostRows;

      if (!post?.id) {
        console.error("[Edge:create-post] Atomic text create returned no post");
        return errorResponse("internal_error", "Failed to create post");
      }

      console.log(
        `[Edge:create-post] ${post.was_created ? "Post created" : "Deduped to existing post"}:`,
        post.id,
      );
    } else {
      const { data: insertedPost, error: postError } = await supabaseAdmin
        .from("posts")
        .insert({
          author_id: userId,
          content: normalizedContent,
          post_kind: postKind,
          text_theme: normalizedTheme,
          location: normalizedLocationValue,
          is_nsfw: normalizedIsNsfw,
          visibility: normalizedVisibility,
          likes_count: 0,
          comments_count: 0,
        })
        .select()
        .single();

      if (postError) {
        console.error("[Edge:create-post] Insert error:", postError);
        return errorResponse("internal_error", "Failed to create post");
      }

      post = insertedPost;

      if (media && media.length > 0) {
        const mediaInserts: Array<Record<string, unknown>> = [];
        media.forEach((m: MediaItem, index: number) => {
          mediaInserts.push({
            _parent_id: post.id,
            type: m.type,
            url: m.url,
            _order: index,
            id: `${post.id}_${index}`,
            mime_type: m.mimeType ?? null,
            live_photo_video_url: m.livePhotoVideoUrl ?? null,
          });

          if (m.type === "video" && m.thumbnail) {
            mediaInserts.push({
              _parent_id: post.id,
              type: "thumbnail",
              url: m.thumbnail,
              _order: index,
              id: `${post.id}_thumb_${index}`,
            });
          }
        });

        const { error: mediaError } = await supabaseAdmin
          .from("posts_media")
          .insert(mediaInserts);

        if (mediaError) {
          console.error("[Edge:create-post] Media insert error:", mediaError);
        }
      }

      console.log("[Edge:create-post] Media post created:", post.id);
    }

    return jsonResponse({
      ok: true,
      data: {
        post: {
          id: String(post.id),
          authorId: String(userId),
          content: post.content,
          location: post.location,
          kind: post.post_kind,
          textTheme: post.text_theme,
          textSlideCount: postKind === "text" ? normalizedSlides.length : 0,
          isNSFW: post.is_nsfw,
          visibility: post.visibility,
          likesCount: 0,
          commentsCount: 0,
          createdAt: post.created_at,
          media: media || [],
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
    console.error("[Edge:create-post] Unexpected error:", err);
    return errorResponse("internal_error", "An unexpected error occurred");
  }
});
