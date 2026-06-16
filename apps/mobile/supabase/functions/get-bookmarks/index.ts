/**
 * Edge Function: get-bookmarks
 *
 * Fetch the current user's bookmarked posts. Uses service role (bypasses RLS).
 * Auth required — validates the Better Auth session token.
 *
 * Request body:
 *   {}                         — returns { postIds: string[], posts: [] }
 *   { withPosts: true }        — returns { postIds, posts } where posts is
 *                                 an array of hydrated post rows ready to
 *                                 feed into transformPost() on the client.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  verifySession,
  jsonResponse,
  errorResponse,
  optionsResponse,
} from "../_shared/verify-session.ts";
import { resolveOrProvisionUser } from "../_shared/resolve-user.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return optionsResponse();
  if (req.method !== "POST") return errorResponse("Method not allowed", 405);

  try {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
      return errorResponse("Server configuration error", 500);
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` } },
    });

    const authId = await verifySession(supabase, req);
    if (!authId) return errorResponse("Unauthorized", 401);

    // Resolve integer user_id — bookmarks are stored with the integer users.id,
    // not the Better Auth auth string. Using authId directly returns 0 rows.
    const userData = await resolveOrProvisionUser(supabase, authId, "id");
    if (!userData) return errorResponse("User not found", 404);
    const userId = userData.id;

    let body: { withPosts?: boolean } = {};
    try {
      const text = await req.text();
      if (text) body = JSON.parse(text);
    } catch {
      // Empty or invalid body is fine — default to postIds only
    }
    const withPosts = body.withPosts === true;

    const { data, error } = await supabase
      .from("bookmarks")
      .select("post_id, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("[Edge:get-bookmarks] bookmarks error:", error);
      return errorResponse("Could not fetch bookmarks", 500);
    }

    const postIds = (data || []).map((b: any) => String(b.post_id));

    if (!withPosts || postIds.length === 0) {
      return jsonResponse({ postIds, posts: [] });
    }

    const numericPostIds = postIds
      .map((id) => Number(id))
      .filter((n) => Number.isFinite(n));

    const { data: posts, error: postsError } = await supabase
      .from("posts")
      .select(
        `
        *,
        author:users!posts_author_id_users_id_fk(
          id,
          username,
          first_name,
          verified,
          avatar:avatar_id(url)
        ),
        media:posts_media(
          type,
          url,
          _order,
          mime_type,
          live_photo_video_url
        )
      `,
      )
      .in("id", numericPostIds);

    if (postsError) {
      console.error("[Edge:get-bookmarks] posts join error:", postsError);
      return jsonResponse({ postIds, posts: [] });
    }

    // Preserve bookmark creation order (bookmarks were fetched DESC above).
    // Build an id→post lookup and iterate postIds — O(n) vs the .sort() O(n log n)
    // it replaces, and it skips posts that went missing between queries.
    const postById = new Map<string, any>();
    for (const p of posts || []) postById.set(String(p.id), p);
    const orderedPosts = postIds
      .map((id) => postById.get(id))
      .filter(Boolean);

    return jsonResponse({ postIds, posts: orderedPosts });
  } catch (err) {
    console.error("[Edge:get-bookmarks] Unexpected error:", err);
    return errorResponse("Internal error", 500);
  }
});
