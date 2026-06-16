/**
 * Bootstrap Notifications Edge Function
 *
 * POST /bootstrap-notifications
 *
 * Returns ALL above-the-fold data for the activity screen in a single request:
 * - Activity items with actor avatars pre-resolved
 * - Unread count
 * - Viewer's follow state for all actors (for follow-back buttons)
 *
 * Eliminates: useActivitiesQuery + fetchFollowingState + getBadges waterfall.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

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
    const { user_id, limit = 50 } = await req.json();

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

    // ── Resolve integer user_id from auth_id (UUID) or integer string ──
    // user_id from client is AppUser.id = Better Auth UUID (auth_id), NOT integer
    let intUserId: number | null = null;
    const asInt = parseInt(user_id, 10);
    if (!isNaN(asInt) && String(asInt) === String(user_id)) {
      // Already an integer string
      intUserId = asInt;
    } else {
      // It's a UUID — resolve via auth_id
      const { data: userRow } = await supabase
        .from("users")
        .select("id")
        .eq("auth_id", user_id)
        .single();
      intUserId = userRow?.id ?? null;
    }

    if (!intUserId) {
      return new Response(JSON.stringify({ error: "User not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    // ── Fire ALL queries in parallel ──────────────────────────────

    const [notificationsResult, unreadCountResult] = await Promise.all([
      // 1. Notifications with sender info + post/event refs
      supabase
        .from("notifications")
        .select(
          `
          id, type, created_at, read_at, content,
          entity_type, entity_id, actor_id,
          sender:users!notifications_actor_id_fk(
            id, username, avatar:avatar_id(url)
          )
        `,
        )
        .eq("recipient_id", intUserId)
        .order("created_at", { ascending: false })
        .limit(limit),

      // 2. Unread count
      supabase
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .eq("recipient_id", intUserId)
        .is("read_at", null),
    ]);

    const notifications = notificationsResult.data || [];
    const isCommentActivity = (notification: any) =>
      notification.type === "comment" || notification.type === "mention";

    // ── Resolve event titles for event_invite / event_update notifications ──
    const eventNotifIds = [
      ...new Set(
        notifications
          .filter(
            (n: any) =>
              (n.type === "event_invite" || n.type === "event_update") &&
              n.entity_id,
          )
          .map((n: any) => parseInt(String(n.entity_id), 10))
          .filter((id: number) => !isNaN(id)),
      ),
    ];
    const eventTitleById = new Map<number, string>();
    if (eventNotifIds.length > 0) {
      const { data: eventRows } = await supabase
        .from("events")
        .select("id, title")
        .in("id", eventNotifIds);
      for (const row of eventRows || []) {
        eventTitleById.set((row as any).id, (row as any).title || "");
      }
    }
    const commentContextByNotificationId = new Map<
      string,
      { commentId: string; postId: string; content?: string }
    >();
    const directCommentContextById = new Map<
      string,
      { commentId: string; postId: string; content?: string }
    >();

    const directCommentIds = [
      ...new Set(
        notifications
          .filter(
            (n: any) =>
              isCommentActivity(n) &&
              n.entity_type === "comment" &&
              n.entity_id,
          )
          .map((n: any) => parseInt(String(n.entity_id), 10))
          .filter((id: number) => !isNaN(id)),
      ),
    ];

    if (directCommentIds.length > 0) {
      const { data: commentRows } = await supabase
        .from("comments")
        .select("id, post_id, content")
        .in("id", directCommentIds);

      for (const row of commentRows || []) {
        const context = {
          commentId: String((row as any).id),
          postId: String((row as any).post_id),
          content: (row as any).content || undefined,
        };
        directCommentContextById.set(context.commentId, context);
      }
    }

    for (const notification of notifications) {
      if (
        isCommentActivity(notification) &&
        notification.entity_type === "comment" &&
        notification.entity_id
      ) {
        const context = directCommentContextById.get(
          String(notification.entity_id),
        );
        if (context) {
          commentContextByNotificationId.set(String(notification.id), context);
        }
      }
    }

    const legacyCommentLookup = new Map<
      string,
      { commentId: string; postId: string; content?: string }
    >();

    for (const notification of notifications) {
      if (
        !isCommentActivity(notification) ||
        notification.entity_type === "comment" ||
        !notification.entity_id ||
        !notification.actor_id
      ) {
        continue;
      }

      const lookupKey = `${notification.actor_id}:${notification.entity_id}`;
      const cached = legacyCommentLookup.get(lookupKey);
      if (cached) {
        commentContextByNotificationId.set(String(notification.id), cached);
        continue;
      }

      const { data: latestComment } = await supabase
        .from("comments")
        .select("id, post_id, content")
        .eq("post_id", parseInt(String(notification.entity_id), 10))
        .eq("author_id", notification.actor_id)
        .order("created_at", { ascending: false })
        .limit(1)
        .single();

      if (!latestComment) continue;

      const context = {
        commentId: String((latestComment as any).id),
        postId: String((latestComment as any).post_id),
        content: (latestComment as any).content || undefined,
      };
      legacyCommentLookup.set(lookupKey, context);
      commentContextByNotificationId.set(String(notification.id), context);
    }

    const resolvedPostIds = [
      ...new Set(
        notifications
          .map((n: any) => {
            if (n.entity_type === "post" && n.entity_id) {
              return parseInt(String(n.entity_id), 10);
            }

            const context = commentContextByNotificationId.get(String(n.id));
            if (context?.postId) {
              return parseInt(context.postId, 10);
            }

            return NaN;
          })
          .filter((id: number) => !isNaN(id)),
      ),
    ];

    const postThumbnailById: Record<string, string> = {};
    if (resolvedPostIds.length > 0) {
      const { data: mediaRows } = await supabase
        .from("posts_media")
        .select("_parent_id, type, url, _order")
        .in("_parent_id", resolvedPostIds)
        .order("_order", { ascending: true });

      for (const row of mediaRows || []) {
        const postId = String((row as any)._parent_id);
        if ((row as any).type === "thumbnail") {
          postThumbnailById[postId] = (row as any).url || "";
          continue;
        }

        if (!postThumbnailById[postId]) {
          postThumbnailById[postId] = (row as any).url || "";
        }
      }
    }

    // 3. Get unique sender IDs to batch-check follow state
    const senderIds = [
      ...new Set(
        notifications
          .map((n: any) => n.sender?.id)
          .filter(Boolean)
          .map(Number)
          .filter((id: number) => !isNaN(id)),
      ),
    ];

    // 4. Batch fetch viewer's follow state for all actors
    // KEY BY USERNAME so client can look up without ID→username mapping
    let viewerFollowingByUsername: Record<string, boolean> = {};
    let viewerFollowingByIds: Record<string, boolean> = {};
    if (senderIds.length > 0) {
      const { data: follows } = await supabase
        .from("follows")
        .select(
          "following_id, target:users!follows_following_id_fkey(username)",
        )
        .eq("follower_id", intUserId)
        .in("following_id", senderIds);

      if (follows) {
        follows.forEach((f: any) => {
          const username = f.target?.username;
          if (username) {
            viewerFollowingByUsername[username] = true;
          }
          viewerFollowingByIds[String(f.following_id)] = true;
        });
      }
    }

    // ── Transform response ─────────────────────────────────────────

    const activities = notifications.map((n: any) => {
      const sender = n.sender;
      const senderAvatarUrl =
        typeof sender?.avatar === "object" ? sender?.avatar?.url : null;
      const commentContext = commentContextByNotificationId.get(String(n.id));
      const resolvedPostId =
        n.entity_type === "post" && n.entity_id
          ? String(n.entity_id)
          : commentContext?.postId || null;
      const senderUsername = sender?.username || "user";
      return {
        id: String(n.id),
        type: n.type || "like",
        createdAt: n.created_at,
        isRead: !!n.read_at,
        actor: {
          id: sender?.id ? String(sender.id) : "",
          username: senderUsername,
          avatarUrl: senderAvatarUrl || "",
          // Embed viewerFollows directly in actor DTO — no separate lookup needed
          viewerFollows: !!viewerFollowingByUsername[senderUsername],
        },
        entityType: n.entity_type || null,
        entityId: n.entity_id ? String(n.entity_id) : null,
        post:
          resolvedPostId !== null
            ? {
                id: resolvedPostId,
                thumbnailUrl: postThumbnailById[resolvedPostId] || "",
              }
            : undefined,
        postId: resolvedPostId || undefined,
        commentId:
          n.entity_type === "comment" && n.entity_id
            ? String(n.entity_id)
            : commentContext?.commentId,
        commentText: commentContext?.content || n.content || undefined,
        event:
          (n.type === "event_invite" || n.type === "event_update") && n.entity_id
            ? {
                id: String(n.entity_id),
                title: eventTitleById.get(parseInt(String(n.entity_id), 10)) || undefined,
              }
            : undefined,
      };
    });

    const elapsed = Date.now() - t0;

    const response = {
      activities,
      unreadCount: unreadCountResult.count || 0,
      // Keyed by username for client compatibility
      viewerFollowing: viewerFollowingByUsername,
      // Also include ID-keyed version for backward compat
      viewerFollowingByIds,
      _meta: {
        elapsed,
        activityCount: activities.length,
        followStateCount: Object.keys(viewerFollowingByUsername).length,
      },
    };

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "private, max-age=15",
      },
    });
  } catch (err: any) {
    console.error("[bootstrap-notifications] Error:", err);
    return new Response(
      JSON.stringify({ error: err.message || "Internal error" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
});
