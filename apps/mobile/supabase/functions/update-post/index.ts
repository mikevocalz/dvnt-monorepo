/**
 * Edge Function: update-post
 * Update a post with Better Auth verification
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

function errorResponse(code: string, message: string): Response {
  return jsonResponse({ ok: false, error: { code, message } }, 200);
}

const TEXT_POST_MAX_SLIDES = 6;
const TEXT_POST_MAX_LENGTH = 2000;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST")
    return errorResponse("validation_error", "Method not allowed");

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer "))
      return errorResponse(
        "unauthorized",
        "Missing or invalid Authorization header",
        401,
      );

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

    let body: {
      postId: number;
      content?: string;
      textTheme?: "graphite" | "cobalt" | "ember" | "sage";
      slides?: string[];
      location?: string;
      isNSFW?: boolean;
      media?: Array<{ order: number; url: string }>;
    };
    try {
      body = await req.json();
    } catch {
      return errorResponse("validation_error", "Invalid JSON body");
    }

    const { postId, content, textTheme, slides, location, isNSFW, media } =
      body;
    if (!postId) return errorResponse("validation_error", "postId is required");

    const userData = await resolveOrProvisionUser(
      supabaseAdmin,
      authUserId,
      "id",
    );
    if (!userData) return errorResponse("not_found", "User not found");

    // Verify ownership
    const { data: post } = await supabaseAdmin
      .from("posts")
      .select("author_id, post_kind")
      .eq("id", postId)
      .single();
    if (!post || post.author_id !== userData.id)
      return errorResponse(
        "forbidden",
        "You can only update your own posts",
        403,
      );

    const updateData: any = {};
    if (content !== undefined) updateData.content = content;
    if (textTheme !== undefined) updateData.text_theme = textTheme;
    if (location !== undefined) updateData.location = location;
    if (isNSFW !== undefined) updateData.is_nsfw = isNSFW;

    const normalizedSlides =
      Array.isArray(slides) && post?.post_kind === "text"
        ? slides
            .map((slide) => (typeof slide === "string" ? slide.trim() : ""))
            .filter((slide) => slide.length > 0)
        : null;

    if (normalizedSlides) {
      if (normalizedSlides.length === 0) {
        return errorResponse(
          "validation_error",
          "Text posts require at least one slide",
          400,
        );
      }
      if (normalizedSlides.length > TEXT_POST_MAX_SLIDES) {
        return errorResponse(
          "validation_error",
          `Text posts support up to ${TEXT_POST_MAX_SLIDES} slides`,
          400,
        );
      }
      if (
        normalizedSlides.some((slide) => slide.length > TEXT_POST_MAX_LENGTH)
      ) {
        return errorResponse(
          "validation_error",
          `Text post slides must be ${TEXT_POST_MAX_LENGTH} characters or fewer`,
          400,
        );
      }
      updateData.content = normalizedSlides[0];
    }

    // Update post columns (if any)
    if (Object.keys(updateData).length > 0) {
      const { error } = await supabaseAdmin
        .from("posts")
        .update(updateData)
        .eq("id", postId);
      if (error)
        return errorResponse("internal_error", "Failed to update post");
    }

    if (normalizedSlides) {
      const { error: deleteSlidesError } = await supabaseAdmin
        .from("post_text_slides")
        .delete()
        .eq("post_id", postId);
      if (deleteSlidesError) {
        console.error(
          "[Edge:update-post] Slide cleanup error:",
          deleteSlidesError,
        );
        return errorResponse("internal_error", "Failed to update text slides");
      }

      const { error: insertSlidesError } = await supabaseAdmin
        .from("post_text_slides")
        .insert(
          normalizedSlides.map((slideContent, index) => ({
            post_id: postId,
            slide_index: index,
            content: slideContent,
          })),
        );

      if (insertSlidesError) {
        console.error(
          "[Edge:update-post] Slide insert error:",
          insertSlidesError,
        );
        return errorResponse("internal_error", "Failed to update text slides");
      }
    }

    // Update media URLs (e.g. after image rotation)
    if (media && Array.isArray(media) && media.length > 0) {
      for (const item of media) {
        if (item.order == null || !item.url) continue;
        // Update by post id + display order
        const { error: mediaError } = await supabaseAdmin
          .from("posts_media")
          .update({ url: item.url })
          .eq("_parent_id", postId)
          .eq("_order", item.order);
        if (mediaError) {
          console.error("[Edge:update-post] Media update error:", mediaError);
        }
      }
    }

    // Re-fetch updated post
    const { data: updated, error: fetchError } = await supabaseAdmin
      .from("posts")
      .select()
      .eq("id", postId)
      .single();
    if (fetchError)
      return errorResponse("internal_error", "Failed to fetch updated post");

    return jsonResponse({ ok: true, data: { post: updated } });
  } catch (err) {
    console.error("[Edge:update-post] Error:", err);
    return errorResponse("internal_error", "An unexpected error occurred");
  }
});
