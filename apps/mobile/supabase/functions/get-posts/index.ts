/** Authenticated projection for feed, profile and direct post reads.
 * Never fall back to returning the service-role query without post-access.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifySession } from "../_shared/verify-session.ts";
import { projectVisiblePosts } from "../_shared/post-access.ts";
const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-auth-token, x-client-info, apikey, content-type, sentry-trace, baggage",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
  "Cache-Control": "private, no-store",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers });
Deno.serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response(null, { status: 204, headers });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const db = createClient(
      Deno.env.get("SUPABASE_URL") || "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "",
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const authId = await verifySession(db, req);
    let userId: number | null = null;
    if (authId) {
      const viewer = await db
        .from("users")
        .select("id")
        .eq("auth_id", authId)
        .maybeSingle();
      if (viewer.error) throw viewer.error;
      userId = viewer.data?.id ?? null;
    }
    const body = await req.json();
    const cursor =
      Number.isSafeInteger(body.cursor) && body.cursor >= 0 ? body.cursor : 0;
    const limit = Number.isSafeInteger(body.limit)
      ? Math.max(1, Math.min(50, body.limit))
      : 10;
    const mode = body.mode || "feed";
    if (!["feed", "profile", "detail"].includes(mode))
      return json({ error: "Invalid mode" }, 400);
    let authorId: number | null = null;
    if (mode === "profile") {
      const ref = String(body.userId || "");
      const column = /^\d+$/.test(ref)
        ? "id"
        : /^[0-9a-f-]{36}$/i.test(ref)
          ? "auth_id"
          : "username";
      const author = await db
        .from("users")
        .select("id")
        .eq(column, ref)
        .maybeSingle();
      if (author.error) throw author.error;
      if (!author.data)
        return json({ posts: [], nextCursor: null, hasMore: false });
      authorId = Number(author.data.id);
    }
    let query = db.from("posts").select(
      `
      id, author_id, visibility, content, post_kind, text_theme, created_at, is_nsfw, location,
      likes_count, comments_count,
      author:users!posts_author_id_users_id_fk(id, username, first_name, verified, avatar:avatar_id(url)),
      media:posts_media(type, url, _order, mime_type, live_photo_video_url, thumbnail),
      post_text_slides(id, slide_index, content)
    `,
      { count: "exact" },
    );
    if (mode === "detail") {
      const id = Number(body.postId);
      if (!Number.isSafeInteger(id) || id <= 0)
        return json({ error: "Invalid post" }, 400);
      query = query.eq("id", id);
    } else {
      if (mode === "profile") query = query.eq("author_id", authorId);
      if (mode === "feed" || authorId !== userId)
        query = query.eq("visibility", "public");
      if (mode === "feed" || typeof body.includeNsfw === "boolean") {
        query =
          body.includeNsfw === true
            ? query.eq("is_nsfw", true)
            : query.or("is_nsfw.is.false,is_nsfw.is.null");
      }
    }
    const result = await query
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(cursor, cursor + limit - 1);
    if (result.error) throw result.error;
    const posts = await projectVisiblePosts(
      db,
      result.data || [],
      { authId, userId },
      { placeholders: true },
    );
    const hasMore = mode !== "detail" && (result.count || 0) > cursor + limit;
    return json({
      posts,
      nextCursor: hasMore ? cursor + limit : null,
      hasMore,
    });
  } catch (error) {
    console.error("[get-posts] Read failed", error);
    return json({ error: "Could not load posts" }, 500);
  }
});
