/**
 * Bootstrap Messages Edge Function
 *
 * POST /bootstrap-messages
 *
 * Returns all above-the-fold data for the messages screen in a single request:
 * - Filtered conversations (primary inbox)
 * - Unread counts (inbox + spam)
 * - Viewer context
 *
 * Eliminates: getFilteredConversations + getUnreadCount + getSpamUnreadCount waterfall.
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
    const { user_id, filter = "primary", limit = 30 } = await req.json();

    if (!user_id) {
      return new Response(JSON.stringify({ error: "user_id required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` } },
    });

    // ── 1. Resolve both integer users.id and auth_id ──────────────────
    let userRow: { id: number; auth_id: string; username?: string } | null =
      null;
    const asInt = parseInt(String(user_id), 10);
    if (!Number.isNaN(asInt) && String(asInt) === String(user_id)) {
      const { data } = await supabase
        .from("users")
        .select("id, auth_id, username")
        .eq("id", asInt)
        .single();
      userRow = data;
    } else {
      const { data } = await supabase
        .from("users")
        .select("id, auth_id, username")
        .eq("auth_id", user_id)
        .single();
      userRow = data;
    }

    if (!userRow) {
      return new Response(JSON.stringify({ error: "user not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    const authId = userRow.auth_id;
    const userIntId = userRow.id;

    // ── 2. Get user's following list (for primary/requests split) ─────
    const { data: followingRows, error: followingError } = await supabase
      .from("follows")
      .select("following_id")
      .eq("follower_id", userIntId);

    const followingIdsKnown = !followingError;
    if (followingError) {
      console.error(
        "[bootstrap-messages] following lookup failed; keeping directs in Inbox",
        followingError,
      );
    }

    const followingIds = new Set(
      (followingRows || []).map((f: any) => String(f.following_id)),
    );

    // ── 3. Get conversations where user is a participant ──────────────
    const { data: convRels } = await supabase
      .from("conversations_rels")
      .select("parent_id")
      .eq("users_id", authId);

    const convIds = (convRels || []).map((r: any) => r.parent_id);

    if (convIds.length === 0) {
      return new Response(
        JSON.stringify({
          conversations: [],
          unreadInbox: 0,
          unreadSpam: 0,
          unreadAuthoritative: true,
          _meta: { elapsed: Date.now() - t0, count: 0 },
        }),
        { headers: { "Content-Type": "application/json" } },
      );
    }

    const [
      { data: incomingRows, error: incomingError },
      { data: readRows, error: readError },
    ] = await Promise.all([
        supabase
          .from("messages")
          .select("conversation_id, created_at")
          .in("conversation_id", convIds)
          .neq("sender_id", userIntId)
          .order("created_at", { ascending: false }),
        supabase
          .from("conversation_reads")
          .select("conversation_id, last_read_at")
          .in("conversation_id", convIds)
          .eq("user_id", userIntId),
      ]);

    const readStateKnown = !incomingError && !readError;
    if (incomingError || readError) {
      console.error("[bootstrap-messages] read-state lookup failed:", {
        incomingError,
        readError,
      });
    }

    const lastReadAtByConv = new Map<number, string>();
    for (const row of readRows || []) {
      if (row?.conversation_id != null && row?.last_read_at) {
        lastReadAtByConv.set(Number(row.conversation_id), row.last_read_at);
      }
    }

    const unreadConvIds = new Set<number>();
    for (const row of incomingRows || []) {
      const convId = Number(row.conversation_id);
      if (!convId || unreadConvIds.has(convId)) continue;
      const lastReadAt = lastReadAtByConv.get(convId);
      if (
        !lastReadAt ||
        new Date(row.created_at).getTime() > new Date(lastReadAt).getTime()
      ) {
        unreadConvIds.add(convId);
      }
    }

    // ── 4. Fetch conversation details + last message + other user ─────
    const conversations = await Promise.all(
      convIds.map(async (convId: number) => {
        // Get conversation metadata
        const { data: conv } = await supabase
          .from("conversations")
          .select("id, is_group, group_name, last_message_at")
          .eq("id", convId)
          .single();

        if (!conv) return null;

        // Get last message (may not exist for new conversations)
        const { data: lastMsgArr } = await supabase
          .from("messages")
          .select("content, created_at, sender_id")
          .eq("conversation_id", convId)
          .order("created_at", { ascending: false })
          .limit(1);
        const lastMsg = lastMsgArr?.[0] || null;

        // Get other participant
        const { data: otherParticipants } = await supabase
          .from("conversations_rels")
          .select("users_id")
          .eq("parent_id", convId)
          .neq("users_id", authId)
          .limit(1);

        const otherAuthId = otherParticipants?.[0]?.users_id;
        let otherUser: any = null;
        if (otherAuthId) {
          const { data: userData } = await supabase
            .from("users")
            .select("id, auth_id, username, avatar_id")
            .eq("auth_id", otherAuthId)
            .single();

          if (userData?.avatar_id) {
            const { data: avatarMedia } = await supabase
              .from("media")
              .select("url")
              .eq("id", userData.avatar_id)
              .single();
            otherUser = { ...userData, avatarUrl: avatarMedia?.url || "" };
          } else {
            otherUser = { ...userData, avatarUrl: "" };
          }
        }

        let hasUnread = unreadConvIds.has(convId);
        if (!readStateKnown) {
          const { count: unreadCount } = await supabase
            .from("messages")
            .select("id", { count: "exact", head: true })
            .eq("conversation_id", convId)
            .is("read_at", null)
            .neq("sender_id", userIntId);
          hasUnread = (unreadCount ?? 0) > 0;
        }

        // Determine if this is primary or request
        const otherIntId = otherUser?.id ? String(otherUser.id) : "";
        const isFollowed = followingIds.has(otherIntId);

        return {
          id: String(convId),
          user: {
            id: otherUser?.id ? String(otherUser.id) : "",
            authId: otherUser?.auth_id || otherAuthId || "",
            name: otherUser?.username || "Unknown",
            username: otherUser?.username || "unknown",
            avatar: otherUser?.avatarUrl || "",
          },
          lastMessage: lastMsg?.content || "",
          timestamp: conv.last_message_at || lastMsg?.created_at || "",
          unread: hasUnread,
          isGroup: !!conv.is_group,
          isPrimary: !followingIdsKnown || isFollowed || !!conv.is_group,
        };
      }),
    );

    const validConvs = conversations
      .filter(Boolean)
      .sort(
        (a: any, b: any) =>
          new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
      );

    // ── 5. Split into primary/requests and count unreads ──────────────
    const primary = validConvs.filter((c: any) => c.isPrimary);
    const requests = validConvs.filter((c: any) => !c.isPrimary);

    const filteredConvs = filter === "primary" ? primary : requests;
    const unreadInbox = primary.filter((c: any) => c.unread).length;
    const unreadSpam = requests.filter((c: any) => c.unread).length;
    const unreadAuthoritative = readStateKnown && followingIdsKnown;

    // Strip isPrimary from response
    const cleanConvs = filteredConvs
      .slice(0, limit)
      .map(({ isPrimary, ...rest }: any) => rest);

    const elapsed = Date.now() - t0;

    return new Response(
      JSON.stringify({
        conversations: cleanConvs,
        unreadInbox,
        unreadSpam,
        unreadAuthoritative,
        _meta: { elapsed, count: cleanConvs.length },
      }),
      { headers: { "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("[bootstrap-messages] Error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
