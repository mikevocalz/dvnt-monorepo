/**
 * Edge Function: update-post
 * Update a post with Better Auth verification
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifySessionDetailed } from "../_shared/verify-session.ts";
import { resolveOrProvisionUser } from "../_shared/resolve-user.ts";
import { resolveVerifiedAdmission, admissionRefusal } from "../_shared/verified-admission.ts";
import { resolveSpicyEligibility } from "../_shared/spicy-eligibility.ts";
import { spicyPostRefusal } from "../_shared/spicy-post-refusal.ts";
import { validatePostCaption } from "../_shared/post-caption.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, sentry-trace, baggage",
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

// Always 200: supabase.functions.invoke throws on non-2xx, and the client
// reads ok/error from the body. The status argument documents intent only.
function errorResponse(code: string, message: string, _status?: number): Response {
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

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !supabaseServiceKey) {
      return errorResponse("internal_error", "Server configuration error");
    }
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${supabaseServiceKey}` } },
    });

    // Verify Better Auth session via shared helper
    const sessionResult = await verifySessionDetailed(supabaseAdmin, req);
    if (!sessionResult.ok) {
      if (sessionResult.reason === "expired") {
        return errorResponse("unauthorized", "Session expired");
      }
      return errorResponse("unauthorized", "Invalid or expired session");
    }

    const authUserId = sessionResult.userId;

    // Verified-only admission, same gate as create-post. A client that skips
    // the banner is still refused.
    const admission = await resolveVerifiedAdmission(supabaseAdmin, authUserId);
    if (admission.state === "blocked") {
      const refusal = admissionRefusal(admission);
      return errorResponse(refusal.code, refusal.message, 403);
    }

    let body: {
      postId: number;
      content?: string;
      textTheme?: "graphite" | "cobalt" | "ember" | "sage";
      slides?: string[];
      location?: string;
      isNSFW?: boolean;
      media?: unknown;
      removeMedia?: { expectedIds: string[]; ids: string[]; expectedCaption?: string };
    };
    try {
      body = await req.json();
    } catch {
      return errorResponse("validation_error", "Invalid JSON body");
    }

    const { postId, content, textTheme, slides, location, isNSFW, media, removeMedia } =
      body;
    if (!Number.isSafeInteger(postId) || postId <= 0) return errorResponse("validation_error", "A valid postId is required");

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

    // SPICY requires approved adult verification or a server-owned legacy
    // entitlement. Direct clients cannot supply either permission themselves.
    if (isNSFW === true) {
      const verification = await resolveSpicyEligibility(supabaseAdmin, authUserId);
      if (verification.state !== "approved") {
        return jsonResponse(spicyPostRefusal(verification), 200);
      }
    }

    if (post.post_kind !== "text" && content !== undefined) {
      const captionValidation = validatePostCaption(content);
      if (!captionValidation.valid) {
        return errorResponse(
          "validation_error",
          captionValidation.error || "Invalid caption",
          400,
        );
      }
    }

    // Older callers may echo existing attachments during a caption edit.
    // Treat only an exact, unambiguous echo as a no-op; never write media URLs
    // or combine a legacy media payload with the atomic remove contract.
    if (media !== undefined) {
      const refuseReplacement = () => errorResponse(
        "validation_error",
        "Existing media cannot be replaced; remove it or edit before sharing.",
      );
      if (removeMedia !== undefined || !Array.isArray(media) || media.length > 10) {
        return refuseReplacement();
      }
      const echoed = new Map<number, string>();
      for (const item of media) {
        if (!item || typeof item !== "object" || Object.keys(item).length !== 2 ||
            !Number.isSafeInteger(item.order) || item.order < 0 ||
            typeof item.url !== "string" || item.url.length === 0 ||
            echoed.has(item.order)) return refuseReplacement();
        echoed.set(item.order, item.url);
      }
      if (echoed.size > 0) {
        if (post.post_kind === "text") return refuseReplacement();
        const { data: current, error } = await supabaseAdmin
          .from("posts_media")
          .select("_order, url")
          .eq("_parent_id", postId)
          .in("_order", [...echoed.keys()]);
        if (error || !Array.isArray(current)) {
          return errorResponse("internal_error", "Could not verify existing media");
        }
        const seen = new Set<number>();
        for (const row of current) {
          if (seen.has(row._order) || !echoed.has(row._order) ||
              echoed.get(row._order) !== row.url) return refuseReplacement();
          seen.add(row._order);
        }
        if (seen.size !== echoed.size) return refuseReplacement();
      }
    }

    const updateData: any = {};
    if (content !== undefined) updateData.content = content;
    if (textTheme !== undefined) updateData.text_theme = textTheme;
    if (location !== undefined) updateData.location = location;
    if (isNSFW !== undefined) updateData.is_nsfw = isNSFW === true;

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

    if (removeMedia !== undefined) {
      const validIds = (ids: unknown): ids is string[] =>
        Array.isArray(ids) && ids.length > 0 && ids.length <= 10 &&
        ids.every((id) => typeof id === "string" && id.length > 0 && id.length <= 255) &&
        new Set(ids).size === ids.length;
      if (!removeMedia || !validIds(removeMedia.expectedIds) || !validIds(removeMedia.ids) ||
          slides !== undefined || textTheme !== undefined ||
          (content !== undefined && (typeof removeMedia.expectedCaption !== "string" ||
            removeMedia.expectedCaption.length > 16000)) ||
          removeMedia.ids.some((id) => !removeMedia.expectedIds.includes(id))) {
        return errorResponse("validation_error", "Invalid media removal");
      }
      const { data, error } = await supabaseAdmin.rpc("remove_owned_post_media", {
        p_post_id: postId,
        p_author_id: userData.id,
        p_expected_ids: removeMedia.expectedIds,
        p_remove_ids: removeMedia.ids,
        p_patch: updateData,
        p_expected_content: removeMedia.expectedCaption ?? null,
      });
      if (error) {
        console.error("[Edge:update-post] Media removal failed:", error.code);
        return errorResponse("internal_error", "Couldn't save the media changes");
      }
      if (data?.result === "caption_changed") {
        return errorResponse("conflict", "The caption changed. Reopen the post before saving.");
      }
      if (data?.result !== "saved") {
        return data?.result === "last_item"
          ? errorResponse("validation_error", "A media post needs at least one item")
          : errorResponse("conflict", "The post changed. Reopen it before removing media.");
      }
      return jsonResponse({ ok: true, data: { post: data.post, remainingIds: data.remainingIds } });
    }

    // Update post columns (if any)
    if (Object.keys(updateData).length > 0) {
      const { data: edited, error } = await supabaseAdmin
        .from("posts")
        .update(updateData)
        .eq("id", postId)
        .eq("author_id", userData.id)
        .select("id")
        .maybeSingle();
      if (error || Number(edited?.id) !== postId)
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
