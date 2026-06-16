/**
 * Bootstrap Profile Edge Function
 *
 * POST /bootstrap-profile
 *
 * Returns ALL above-the-fold data for the profile screen in a single request:
 * - Profile header (username, bio, avatar, counts, verified)
 * - Relationship state (viewer following/followed-by)
 * - First page of posts (thumbnails for grid)
 *
 * Eliminates 6+ independent queries on the profile tab.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const GRID_PAGE_SIZE = 18; // 6 rows x 3 columns = 2 screens worth

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      },
    });
  }

  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const t0 = Date.now();

  try {
    const { user_id, viewer_id, include_nsfw = false } = await req.json();

    if (!user_id) {
      return new Response(JSON.stringify({ error: "Missing user_id" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` } },
    });

    const resolveUserId = async (value: string | number | null | undefined) => {
      if (value === null || value === undefined) return null;
      const asString = String(value).trim();
      if (!asString) return null;
      const asInt = parseInt(asString, 10);
      if (!isNaN(asInt) && String(asInt) === asString) return asInt;

      const { data } = await supabase
        .from("users")
        .select("id")
        .eq("auth_id", asString)
        .single();
      return data?.id ?? null;
    };

    const profileUserId = await resolveUserId(user_id);
    if (!profileUserId) {
      return new Response(JSON.stringify({ error: "Profile not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    const viewerUserId = await resolveUserId(viewer_id);
    const isOwnProfile = !viewerUserId || viewerUserId === profileUserId;

    // ── NSFW follow gate ──────────────────────────────────────────
    // Viewer may only see spicy posts from a profile if they follow that
    // profile's owner (or they ARE the owner). Force safe mode otherwise.
    let effectiveIncludeNsfw = include_nsfw;
    if (effectiveIncludeNsfw && !isOwnProfile) {
      if (!viewerUserId) {
        // Guest — never allow spicy
        effectiveIncludeNsfw = false;
      } else {
        const { data: followRow } = await supabase
          .from("follows")
          .select("id")
          .eq("follower_id", viewerUserId)
          .eq("following_id", profileUserId)
          .maybeSingle();
        if (!followRow) {
          effectiveIncludeNsfw = false;
        }
      }
    }

    // ── Fire ALL queries in parallel ──────────────────────────────

    let profilePostsQuery = supabase
      .from("posts")
      .select(
        `
          id, created_at, content, post_kind, text_theme, is_nsfw, likes_count,
          media:posts_media(type, url, "order")
        `,
      )
      .eq("author_id", profileUserId)
      .eq("visibility", "public");

    // Strict spicy contract (mirror feed filter):
    if (effectiveIncludeNsfw) {
      profilePostsQuery = profilePostsQuery.eq("is_nsfw", true);
    } else {
      profilePostsQuery = profilePostsQuery.or(
        "is_nsfw.is.false,is_nsfw.is.null",
      );
    }

    profilePostsQuery = profilePostsQuery
      .order("created_at", { ascending: false })
      .range(0, GRID_PAGE_SIZE - 1);

    const queries: Promise<any>[] = [
      // 1. Profile data
      supabase
        .from("users")
        .select(
          `
          id, auth_id, username, first_name, bio, website, location,
          verified, followers_count, following_count, posts_count,
          avatar:avatar_id(url)
        `,
        )
        .eq("id", profileUserId)
        .single(),

      // 2. First page of posts (grid thumbnails)
      profilePostsQuery,
    ];

    // 3. Relationship state (only if viewing another user's profile)
    if (!isOwnProfile && viewer_id) {
      queries.push(
        supabase
          .from("follows")
          .select("id")
          .eq("follower_id", viewerUserId)
          .eq("following_id", profileUserId)
          .maybeSingle(),
      );
      queries.push(
        supabase
          .from("follows")
          .select("id")
          .eq("follower_id", profileUserId)
          .eq("following_id", viewerUserId)
          .maybeSingle(),
      );
    }

    const results = await Promise.all(queries);

    const profileResult = results[0];
    const postsResult = results[1];
    const viewerFollowsResult = !isOwnProfile ? results[2] : null;
    const followsViewerResult = !isOwnProfile ? results[3] : null;

    if (profileResult.error || !profileResult.data) {
      return new Response(JSON.stringify({ error: "Profile not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    // ── Build response ─────────────────────────────────────────────

    const p = profileResult.data;
    const avatarUrl = typeof p.avatar === "object" ? p.avatar?.url : null;

    const posts = (postsResult.data || []).map((post: any) => {
      const media = (post.media || []).sort(
        (a: any, b: any) => (a.order || 0) - (b.order || 0),
      );
      const firstMedia = media[0];
      const isTextPost = post.post_kind === "text";
      const previewText =
        typeof post.content === "string" ? post.content.trim() : "";

      return {
        id: String(post.id),
        kind: isTextPost ? "text" : "media",
        textTheme: post.text_theme || null,
        caption: previewText,
        textSlideCount: isTextPost && previewText ? 1 : 0,
        media: isTextPost
          ? []
          : media.map((item: any) => ({
              type: item.type || "image",
              url: item.url || "",
            })),
        thumbnailUrl: firstMedia?.url || "",
        type: firstMedia?.type || "image",
        likesCount: post.likes_count || 0,
        isNSFW: post.is_nsfw || false,
      };
    });

    const elapsed = Date.now() - t0;

    const response = {
      profile: {
        id: String(p.id),
        authId: p.auth_id,
        username: p.username || "",
        firstName: p.first_name || "",
        bio: p.bio || "",
        website: p.website || "",
        location: p.location || "",
        avatarUrl: avatarUrl || "",
        followersCount: p.followers_count || 0,
        followingCount: p.following_count || 0,
        postsCount: p.posts_count || 0,
        verified: p.verified || false,
        viewerIsFollowing: viewerFollowsResult?.data ? true : false,
        viewerIsFollowedBy: followsViewerResult?.data ? true : false,
      },
      posts,
      nextCursor: posts.length >= GRID_PAGE_SIZE ? GRID_PAGE_SIZE : null,
      hasMore: posts.length >= GRID_PAGE_SIZE,
      _meta: { elapsed, postCount: posts.length },
    };

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "private, max-age=60",
      },
    });
  } catch (err: any) {
    console.error("[bootstrap-profile] Error:", err);
    return new Response(
      JSON.stringify({ error: err.message || "Internal error" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
});
