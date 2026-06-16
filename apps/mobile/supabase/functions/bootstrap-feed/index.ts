/**
 * Bootstrap Feed Edge Function
 *
 * POST /bootstrap-feed
 *
 * Returns ALL above-the-fold data for the feed screen in a single request:
 * - Paginated feed posts (with author, media, viewer like/bookmark state)
 * - Stories row (users with unseen stories)
 * - Viewer context (unread messages, unread notifications badges)
 *
 * This eliminates the N-query waterfall on the feed screen.
 * Client falls back to individual queries if this fails.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const PAGE_SIZE = 20;

async function getAuthoritativeUnreadInboxCount(
  supabase: any,
  user: { intUserId: number | null; authUserId: string | null },
): Promise<{ count: number; authoritative: boolean }> {
  const { intUserId, authUserId } = user;
  if (!intUserId || !authUserId) {
    return { count: 0, authoritative: false };
  }

  const [
    { data: followingRows, error: followingError },
    { data: convRels, error: convRelsError },
  ] = await Promise.all([
    supabase
      .from("follows")
      .select("following_id")
      .eq("follower_id", intUserId),
    supabase
      .from("conversations_rels")
      .select("parent_id, conversation:parent_id(id, is_group)")
      .eq("users_id", authUserId),
  ]);

  if (followingError || convRelsError) {
    console.error("[bootstrap-feed] unread lookup failed:", {
      followingError,
      convRelsError,
    });
    return { count: 0, authoritative: false };
  }

  const conversationRows = (convRels || []).filter(
    (row: any) => row.conversation,
  );
  if (conversationRows.length === 0) {
    return { count: 0, authoritative: true };
  }

  const convIds = conversationRows.map((row: any) => row.parent_id);
  const [
    { data: incomingRows, error: incomingError },
    { data: readRows, error: readError },
  ] = await Promise.all([
    supabase
      .from("messages")
      .select("conversation_id, created_at")
      .in("conversation_id", convIds)
      .neq("sender_id", intUserId)
      .order("created_at", { ascending: false }),
    supabase
      .from("conversation_reads")
      .select("conversation_id, last_read_at")
      .in("conversation_id", convIds)
      .eq("user_id", intUserId),
  ]);

  if (incomingError || readError) {
    console.error("[bootstrap-feed] unread messages query failed:", {
      incomingError,
      readError,
    });
    return { count: 0, authoritative: false };
  }

  const lastReadAtByConv = new Map<number, string>();
  for (const row of readRows || []) {
    if (row?.conversation_id != null && row?.last_read_at) {
      lastReadAtByConv.set(Number(row.conversation_id), row.last_read_at);
    }
  }

  const unreadConvIds = new Set(
    (incomingRows || [])
      .filter((row: any) => {
        const convId = Number(row.conversation_id);
        const lastReadAt = lastReadAtByConv.get(convId);
        return (
          !convId ||
          !lastReadAt ||
          new Date(row.created_at).getTime() > new Date(lastReadAt).getTime()
        );
      })
      .map((row: any) => Number(row.conversation_id)),
  );
  if (unreadConvIds.size === 0) {
    return { count: 0, authoritative: true };
  }

  const followedIds = new Set(
    (followingRows || []).map((row: any) => String(row.following_id)),
  );
  const groupConvIds = new Set(
    conversationRows
      .filter((row: any) => row.conversation?.is_group)
      .map((row: any) => Number(row.parent_id)),
  );

  let unreadInboxCount = 0;
  const unreadDirectConvIds = [...unreadConvIds].filter(
    (convId) => !groupConvIds.has(convId),
  );

  for (const convId of unreadConvIds) {
    if (groupConvIds.has(convId)) {
      unreadInboxCount += 1;
    }
  }

  if (unreadDirectConvIds.length === 0) {
    return { count: unreadInboxCount, authoritative: true };
  }

  const { data: otherParticipants, error: participantsError } = await supabase
    .from("conversations_rels")
    .select("parent_id, users_id")
    .in("parent_id", unreadDirectConvIds)
    .neq("users_id", authUserId);

  if (participantsError) {
    console.error(
      "[bootstrap-feed] unread participants query failed:",
      participantsError,
    );
    return { count: unreadInboxCount, authoritative: false };
  }

  const otherAuthIds = [
    ...new Set(
      (otherParticipants || []).map((row: any) => row.users_id).filter(Boolean),
    ),
  ];

  const { data: otherUsers, error: otherUsersError } =
    otherAuthIds.length > 0
      ? await supabase
          .from("users")
          .select("id, auth_id")
          .in("auth_id", otherAuthIds)
      : { data: [], error: null };

  if (otherUsersError) {
    console.error(
      "[bootstrap-feed] unread user resolution failed:",
      otherUsersError,
    );
    return { count: unreadInboxCount, authoritative: false };
  }

  const userIdByAuthId = new Map<string, string>();
  for (const user of otherUsers || []) {
    if (user?.auth_id != null && user?.id != null) {
      userIdByAuthId.set(String(user.auth_id), String(user.id));
    }
  }

  for (const row of otherParticipants || []) {
    const otherUserId = userIdByAuthId.get(String(row.users_id));
    if (otherUserId && followedIds.has(otherUserId)) {
      unreadInboxCount += 1;
    }
  }

  return { count: unreadInboxCount, authoritative: true };
}

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
    const {
      user_id,
      cursor = 0,
      limit = PAGE_SIZE,
      include_nsfw = false,
    } = await req.json();

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

    // ── Resolve integer users.id from auth_id UUID ────────────────
    // user_id from client is AppUser.id = Better Auth UUID, NOT integer
    let intUserId: number | null = null;
    let authUserId: string | null = null;
    const asInt = parseInt(user_id, 10);
    if (!isNaN(asInt) && String(asInt) === String(user_id)) {
      const { data: userRow } = await supabase
        .from("users")
        .select("id, auth_id")
        .eq("id", asInt)
        .single();
      intUserId = userRow?.id ?? asInt;
      authUserId = userRow?.auth_id ?? null;
    } else {
      const { data: userRow } = await supabase
        .from("users")
        .select("id, auth_id")
        .eq("auth_id", user_id)
        .single();
      intUserId = userRow?.id ?? null;
      authUserId = userRow?.auth_id ?? user_id;
    }

    const unreadMessagesResult = await getAuthoritativeUnreadInboxCount(
      supabase,
      { intUserId, authUserId },
    );

    // ── NSFW follow gate: resolve which author IDs viewer may see spicy from ──
    // Spicy posts are only shown to logged-in users who follow the author (or are the author).
    // Guests (intUserId=null) requesting include_nsfw=true get an empty feed.
    let spicyAuthorIds: number[] | null = null;
    if (include_nsfw) {
      if (!intUserId) {
        // Guest cannot see spicy content — return empty feed immediately
        return new Response(
          JSON.stringify({
            posts: [],
            stories: [],
            hasMore: false,
            totalCount: 0,
            unreadMessages: 0,
            unreadNotifications: 0,
            viewerProfile: null,
            ms: Date.now() - t0,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      // Fetch the set of author IDs the viewer follows + themselves
      const { data: followRows } = await supabase
        .from("follows")
        .select("following_id")
        .eq("follower_id", intUserId);
      const followedIds = (followRows || []).map((r: any) => Number(r.following_id));
      followedIds.push(intUserId); // own posts always visible
      spicyAuthorIds = followedIds;
    }

    // ── Fire ALL queries in parallel — never sequential ──────────

    let postsQuery = supabase
      .from("posts")
      .select(
        `
          id, content, post_kind, text_theme, created_at, visibility, is_nsfw, location,
          likes_count, comments_count,
          author:users!posts_author_id_users_id_fk(
            id, username, first_name, verified,
            avatar:avatar_id(url)
          ),
          media:posts_media(type, url, "order", mime_type, live_photo_video_url),
          post_text_slides(id, slide_index, content)
        `,
        { count: "exact" },
      )
      .eq("visibility", "public");

    // Strict spicy contract:
    //   include_nsfw=false → ONLY safe posts (is_nsfw=false OR NULL)
    //   include_nsfw=true  → ONLY spicy posts (is_nsfw=true) from followed authors
    if (include_nsfw && spicyAuthorIds !== null) {
      postsQuery = postsQuery
        .eq("is_nsfw", true)
        .in("author_id", spicyAuthorIds);
    } else {
      postsQuery = postsQuery.or("is_nsfw.is.false,is_nsfw.is.null");
    }

    postsQuery = postsQuery
      .order("created_at", { ascending: false })
      .range(cursor, cursor + limit - 1);

    const [
      postsResult,
      viewerLikesResult,
      viewerBookmarksResult,
      storiesResult,
      unreadNotificationsResult,
      viewerProfileResult,
    ] = await Promise.all([
      // 1. Feed posts with author + media (single join query)
      postsQuery,

      // 2. Viewer's liked post IDs — use integer ID
      intUserId
        ? supabase.from("post_likes").select("post_id").eq("user_id", intUserId)
        : Promise.resolve({ data: [] }),

      // 3. Viewer's bookmarked post IDs — use integer ID
      intUserId
        ? supabase.from("bookmarks").select("post_id").eq("user_id", intUserId)
        : Promise.resolve({ data: [] }),

      // 4. Stories with unseen items (last 24 hours)
      supabase
        .from("stories")
        .select(
          `
          id, user_id,
          user:users!stories_user_id_fkey(id, username, avatar:avatar_id(url)),
          items:stories_items(id, url, thumbnail, type, created_at)
        `,
        )
        .gte(
          "created_at",
          new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
        )
        .order("created_at", { ascending: false })
        .limit(30),

      // 5. Unread notification count — use integer ID
      intUserId
        ? supabase
            .from("notifications")
            .select("id", { count: "exact", head: true })
            .eq("recipient_id", intUserId)
            .is("read_at", null)
        : Promise.resolve({ count: 0 }),

      // 6. Viewer profile snippet
      authUserId
        ? supabase
            .from("users")
            .select("id, username, first_name, avatar:avatar_id(url), verified")
            .eq("auth_id", authUserId)
            .single()
        : intUserId
          ? supabase
              .from("users")
              .select(
                "id, username, first_name, avatar:avatar_id(url), verified",
              )
              .eq("id", intUserId)
              .single()
          : Promise.resolve({ data: null }),
    ]);

    // ── Build response ─────────────────────────────────────────────

    const posts = postsResult.data || [];
    const totalPosts = postsResult.count || 0;

    // Build liked/bookmarked sets for O(1) lookup
    const likedSet = new Set(
      (viewerLikesResult.data || []).map((r: any) => String(r.post_id)),
    );
    const bookmarkedSet = new Set(
      (viewerBookmarksResult.data || []).map((r: any) => String(r.post_id)),
    );

    // Transform posts with pre-resolved viewer state
    const transformedPosts = posts.map((p: any) => {
      const pid = String(p.id);
      const author = p.author;
      const avatarUrl =
        typeof author?.avatar === "object" ? author?.avatar?.url : null;
      const textSlides = Array.isArray(p.post_text_slides)
        ? p.post_text_slides
            .sort(
              (a: any, b: any) =>
                Number(a?.slide_index ?? 0) - Number(b?.slide_index ?? 0),
            )
            .map((slide: any, index: number) => {
              const parsedOrder = Number(slide?.slide_index);
              return {
                id:
                  slide?.id != null && String(slide.id).length > 0
                    ? String(slide.id)
                    : `${pid}-slide-${index}`,
                order: Number.isFinite(parsedOrder) ? parsedOrder : index,
                content:
                  typeof slide?.content === "string" ? slide.content : "",
              };
            })
        : [];

      return {
        id: pid,
        caption: p.content || "",
        kind: p.post_kind === "text" ? "text" : "media",
        textTheme: p.text_theme || null,
        textSlides,
        createdAt: p.created_at,
        isNSFW: p.is_nsfw || false,
        location: p.location || null,
        likes: p.likes_count || 0,
        commentsCount: p.comments_count || 0,
        viewerHasLiked: likedSet.has(pid),
        viewerHasBookmarked: bookmarkedSet.has(pid),
        author: {
          id: author?.id ? String(author.id) : undefined,
          username: author?.username || "unknown",
          firstName: author?.first_name || "",
          avatar: avatarUrl || "",
          verified: author?.verified || false,
        },
        media: (p.media || [])
          .sort((a: any, b: any) => (a.order || 0) - (b.order || 0))
          .map((m: any) => {
            const rawType: string = m.type || "image";
            const mimeType: string | undefined = m.mime_type || undefined;
            const livePhotoVideoUrl: string | undefined =
              m.live_photo_video_url || undefined;
            // Normalize to client MediaKind — mirrors transformPost in posts.ts
            let kind = rawType;
            if (rawType === "video" && mimeType === "video/mp4+animated")
              kind = "animated_video";
            else if (rawType === "gif" || mimeType === "image/gif")
              kind = "gif";
            else if (rawType === "livePhoto" || livePhotoVideoUrl)
              kind = "livePhoto";
            return {
              type: kind,
              url: m.url || "",
              ...(mimeType ? { mimeType } : {}),
              ...(livePhotoVideoUrl ? { livePhotoVideoUrl } : {}),
            };
          }),
      };
    });

    // Transform stories
    const stories = (storiesResult.data || []).map((s: any) => {
      const items = s.items || [];
      const lastItem = items[items.length - 1];
      const user = s.user;
      const avatarUrl =
        typeof user?.avatar === "object" ? user?.avatar?.url : null;

      return {
        id: String(s.id),
        userId: String(s.user_id),
        username: user?.username || "unknown",
        avatarUrl: avatarUrl || "",
        latestThumbnail: lastItem?.thumbnail || lastItem?.url || "",
        itemCount: items.length,
      };
    });

    // Viewer context
    const viewerProfile = viewerProfileResult.data;
    const viewerAvatarUrl =
      typeof viewerProfile?.avatar === "object"
        ? viewerProfile?.avatar?.url
        : null;

    const hasMore = totalPosts > cursor + limit;
    const nextCursor = hasMore ? cursor + limit : null;
    const elapsed = Date.now() - t0;

    const response = {
      posts: transformedPosts,
      stories,
      viewer: {
        id: user_id,
        username: viewerProfile?.username || "",
        avatarUrl: viewerAvatarUrl || "",
        unreadMessages: unreadMessagesResult.count || 0,
        unreadMessagesAuthoritative: unreadMessagesResult.authoritative,
        unreadNotifications: unreadNotificationsResult.count || 0,
      },
      nextCursor,
      hasMore,
      _meta: {
        elapsed,
        postCount: transformedPosts.length,
        storyCount: stories.length,
      },
    };

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "private, max-age=30",
      },
    });
  } catch (err: any) {
    console.error("[bootstrap-feed] Error:", err);
    return new Response(
      JSON.stringify({ error: err.message || "Internal error" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
});
