import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

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
  return jsonResponse({ ok: false, error: { code, message } }, status);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return errorResponse("validation_error", "Method not allowed", 405);
  }

  try {
    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` } },
    });

    let viewerUserId: number | null = null;
    const authHeader = req.headers.get("Authorization");
    if (authHeader?.startsWith("Bearer ")) {
      const token = authHeader.replace("Bearer ", "").trim();
      if (token) {
        const { data: sessionData } = await supabaseAdmin
          .from("session")
          .select("userId, expiresAt")
          .eq("token", token)
          .maybeSingle();

        if (sessionData && new Date(sessionData.expiresAt) >= new Date()) {
          const { data: userRow } = await supabaseAdmin
            .from("users")
            .select("id")
            .eq("auth_id", sessionData.userId)
            .maybeSingle();
          viewerUserId = userRow?.id ?? null;
        }
      }
    }

    const body = await req.json().catch(() => null);
    const postIds = Array.isArray(body?.postIds)
      ? Array.from(
          new Set(
            body.postIds
              .map((value: unknown) => Number(value))
              .filter((value: number) => Number.isFinite(value)),
          ),
        )
      : [];

    if (postIds.length === 0) {
      return jsonResponse({
        ok: true,
        data: { posts: [] as Array<{ postId: string; slides: unknown[] }> },
      });
    }

    const { data: posts, error: postsError } = await supabaseAdmin
      .from("posts")
      .select("id, author_id, visibility, post_kind")
      .in("id", postIds)
      .eq("post_kind", "text");

    if (postsError) {
      console.error("[get-text-post-slides] posts error:", postsError);
      return errorResponse(
        "internal_error",
        "Failed to load text post metadata",
        500,
      );
    }

    const allowedPostIds = (posts || [])
      .filter((post: any) => {
        const visibility = String(post?.visibility || "public");
        return visibility === "public" || post?.author_id === viewerUserId;
      })
      .map((post: any) => Number(post.id))
      .filter((postId: number) => Number.isFinite(postId));

    if (allowedPostIds.length === 0) {
      return jsonResponse({
        ok: true,
        data: { posts: [] as Array<{ postId: string; slides: unknown[] }> },
      });
    }

    const { data: slides, error: slidesError } = await supabaseAdmin
      .from("post_text_slides")
      .select("id, post_id, slide_index, content")
      .in("post_id", allowedPostIds)
      .order("slide_index", { ascending: true });

    if (slidesError) {
      console.error("[get-text-post-slides] slides error:", slidesError);
      return errorResponse("internal_error", "Failed to load text slides", 500);
    }

    const slidesByPostId = new Map<number, any[]>();
    for (const slide of slides || []) {
      const postId = Number(slide?.post_id);
      if (!Number.isFinite(postId)) continue;
      const existing = slidesByPostId.get(postId) || [];
      existing.push(slide);
      slidesByPostId.set(postId, existing);
    }

    return jsonResponse({
      ok: true,
      data: {
        posts: allowedPostIds.map((postId) => ({
          postId: String(postId),
          slides: slidesByPostId.get(postId) || [],
        })),
      },
    });
  } catch (error: any) {
    console.error("[get-text-post-slides] error:", error);
    return errorResponse(
      "internal_error",
      error?.message || "Unexpected error",
      500,
    );
  }
});
