import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveOrProvisionUser } from "../_shared/resolve-user.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

async function getUnreadCountsSnapshot(
  supabase: any,
  authUserId: string,
  userIntId: number,
): Promise<{ inbox: number; spam: number; authoritative: boolean }> {
  const [
    { data: followingRows, error: followingError },
    { data: convRels, error: convRelsError },
  ] = await Promise.all([
    supabase
      .from("follows")
      .select("following_id")
      .eq("follower_id", userIntId),
    supabase
      .from("conversations_rels")
      .select("parent_id, conversation:parent_id(id, is_group)")
      .eq("users_id", authUserId),
  ]);

  if (convRelsError) {
    console.error("[mark-read] conversation lookup failed:", convRelsError);
    return { inbox: 0, spam: 0, authoritative: false };
  }

  const conversationRows = (convRels || []).filter((row: any) => row.conversation);
  if (conversationRows.length === 0) {
    return { inbox: 0, spam: 0, authoritative: !followingError };
  }

  const convIds = conversationRows.map((row: any) => Number(row.parent_id));
  const [{ data: incomingRows, error: incomingError }, { data: readRows, error: readError }] =
    await Promise.all([
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

  if (incomingError || readError) {
    console.error("[mark-read] unread snapshot lookup failed:", {
      incomingError,
      readError,
    });
    return { inbox: 0, spam: 0, authoritative: false };
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

  if (unreadConvIds.size === 0) {
    return { inbox: 0, spam: 0, authoritative: !followingError };
  }

  const followedIds = new Set(
    (followingRows || []).map((row: any) => String(row.following_id)),
  );
  const groupConvIds = new Set(
    conversationRows
      .filter((row: any) => row.conversation?.is_group)
      .map((row: any) => Number(row.parent_id)),
  );

  let inbox = 0;
  for (const convId of unreadConvIds) {
    if (groupConvIds.has(convId)) {
      inbox += 1;
    }
  }

  const unreadDirectConvIds = [...unreadConvIds].filter(
    (convId) => !groupConvIds.has(convId),
  );
  if (unreadDirectConvIds.length === 0) {
    return { inbox, spam: 0, authoritative: !followingError };
  }

  const { data: otherParticipants, error: participantsError } = await supabase
    .from("conversations_rels")
    .select("parent_id, users_id")
    .in("parent_id", unreadDirectConvIds)
    .neq("users_id", authUserId);

  if (participantsError) {
    console.error("[mark-read] participant lookup failed:", participantsError);
    return { inbox, spam: 0, authoritative: false };
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
    console.error("[mark-read] user resolution failed:", otherUsersError);
    return { inbox, spam: 0, authoritative: false };
  }

  const userIdByAuthId = new Map<string, string>();
  for (const user of otherUsers || []) {
    if (user?.auth_id != null && user?.id != null) {
      userIdByAuthId.set(String(user.auth_id), String(user.id));
    }
  }

  let spam = 0;
  for (const row of otherParticipants || []) {
    const otherUserId = userIdByAuthId.get(String(row.users_id));
    if (!otherUserId) continue;

    if (followingError) {
      inbox += 1;
      continue;
    }

    if (followedIds.has(otherUserId)) {
      inbox += 1;
    } else {
      spam += 1;
    }
  }

  return { inbox, spam, authoritative: !followingError };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ ok: false, error: "Method not allowed" }),
      {
        status: 405,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }

  try {
    // 1. Verify session
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ ok: false, error: "Unauthorized" }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const token = authHeader.replace("Bearer ", "");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const supabase = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${serviceKey}` } },
    });

    // Verify Better Auth session
    const { data: session, error: sessionError } = await supabase
      .from("session")
      .select("id, userId, expiresAt")
      .eq("token", token)
      .single();

    if (sessionError || !session) {
      return new Response(
        JSON.stringify({ ok: false, error: "Invalid session" }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }
    if (new Date(session.expiresAt) < new Date()) {
      return new Response(
        JSON.stringify({ ok: false, error: "Session expired" }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const authUserId = session.userId;

    // 2. Get user's integer ID from users table (auto-provision if needed)
    const userRow = await resolveOrProvisionUser(supabase, authUserId, "id");
    if (!userRow) {
      return new Response(
        JSON.stringify({ ok: false, error: "User not found" }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const userIntId = userRow.id;

    // 3. Parse body
    const body = await req.json();
    const conversationId = body.conversationId;

    if (!conversationId) {
      return new Response(
        JSON.stringify({ ok: false, error: "conversationId required" }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // 4. Verify user is participant in conversation
    const { data: rel } = await supabase
      .from("conversations_rels")
      .select("id")
      .eq("parent_id", conversationId)
      .eq("users_id", authUserId)
      .single();

    if (!rel) {
      return new Response(
        JSON.stringify({ ok: false, error: "Not a participant" }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const readAt = new Date().toISOString();
    const { data: conversation } = await supabase
      .from("conversations")
      .select("is_group")
      .eq("id", conversationId)
      .single();

    const { error: readCursorError } = await supabase
      .from("conversation_reads")
      .upsert(
        {
          conversation_id: conversationId,
          user_id: userIntId,
          last_read_at: readAt,
          updated_at: readAt,
        },
        { onConflict: "conversation_id,user_id" },
      );

    if (readCursorError) {
      console.error("[mark-read] conversation_reads upsert error:", readCursorError);
      return new Response(
        JSON.stringify({ ok: false, error: readCursorError.message }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    let updated: Array<{ id: number }> | null = [];
    let updateError: { message?: string } | null = null;

    // Direct chats still use message.read_at for the visible "Read" receipt UI.
    if (!conversation?.is_group) {
      const directReadResult = await supabase
        .from("messages")
        .update({ read_at: readAt })
        .eq("conversation_id", conversationId)
        .is("read_at", null)
        .neq("sender_id", userIntId)
        .select("id");

      updated = directReadResult.data;
      updateError = directReadResult.error;
    }

    if (updateError) {
      console.error("[mark-read] Update error:", updateError);
      return new Response(
        JSON.stringify({ ok: false, error: updateError.message }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const count = updated?.length || 0;
    console.log(
      `[mark-read] Marked ${count} messages as read in conversation ${conversationId}`,
    );

    const unread = await getUnreadCountsSnapshot(supabase, authUserId, userIntId);

    return new Response(
      JSON.stringify({ ok: true, data: { markedRead: count, unread } }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (err) {
    console.error("[mark-read] Error:", err);
    return new Response(
      JSON.stringify({ ok: false, error: "Internal error" }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
