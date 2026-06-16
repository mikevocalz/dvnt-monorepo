/**
 * Edge Function: get-post-likers
 * Fetch all users who liked a post. Uses service role to bypass RLS
 * (Better Auth doesn't set auth.uid(), so client queries may miss rows).
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface LikerRow {
  userId: number;
  username: string;
  avatar: string;
  displayName: string;
  likedAt: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    let body: { postId?: number | string };
    try {
      body = await req.json();
    } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const postId = body?.postId != null ? String(body.postId) : null;
    if (!postId) {
      return new Response(JSON.stringify({ error: "postId is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const postIdInt = parseInt(postId);
    if (isNaN(postIdInt)) {
      return new Response(JSON.stringify({ error: "Invalid postId" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !supabaseServiceKey) {
      return new Response(
        JSON.stringify({ error: "Server configuration error" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${supabaseServiceKey}` } },
    });

    const { data, error } = await supabaseAdmin
      .from("likes")
      .select(
        `
        user_id,
        created_at,
        user:user_id(
          id,
          username,
          first_name,
          avatar:avatar_id(url)
        )
      `,
      )
      .eq("post_id", postIdInt)
      .order("created_at", { ascending: false })
      .limit(500);

    if (error) {
      console.error("[Edge:get-post-likers] Supabase error:", error);
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const actualCount = (data || []).length;

    // Collect user_ids that have no users row so we can resolve via Better Auth
    const missingUserIds = (data || [])
      .filter((row: any) => !row.user?.username)
      .map((row: any) => row.user_id);

    // Try to resolve missing users via Better Auth user table
    let authFallback: Record<number, { name: string }> = {};
    if (missingUserIds.length > 0) {
      // Get auth_id from users table for these IDs, then name from user table
      const { data: authUsers } = await supabaseAdmin
        .from("users")
        .select("id, auth_id")
        .in("id", missingUserIds);

      if (authUsers?.length) {
        const authIds = authUsers.map((u: any) => u.auth_id).filter(Boolean);
        const { data: betterAuthUsers } = await supabaseAdmin
          .from("user")
          .select("id, name")
          .in("id", authIds);

        if (betterAuthUsers?.length) {
          const authIdToName = new Map(
            betterAuthUsers.map((u: any) => [u.id, u.name]),
          );
          for (const au of authUsers) {
            const name = authIdToName.get(au.auth_id);
            if (name) authFallback[au.id] = { name };
          }
        }
      }
    }

    const likers: LikerRow[] = (data || []).map((row: any) => ({
      userId: row.user_id,
      username: row.user?.username || authFallback[row.user_id]?.name || "User",
      avatar: row.user?.avatar?.url || "",
      displayName:
        row.user?.first_name ||
        row.user?.username ||
        authFallback[row.user_id]?.name ||
        "User",
      likedAt: row.created_at,
    }));

    // Reconcile likes_count if it drifted from actual count
    const { data: postRow } = await supabaseAdmin
      .from("posts")
      .select("likes_count")
      .eq("id", postIdInt)
      .single();

    if (postRow && postRow.likes_count !== actualCount) {
      console.log(
        `[Edge:get-post-likers] Reconciling likes_count: ${postRow.likes_count} → ${actualCount} for post ${postIdInt}`,
      );
      await supabaseAdmin
        .from("posts")
        .update({ likes_count: actualCount })
        .eq("id", postIdInt);
    }

    return new Response(JSON.stringify({ likers, likesCount: actualCount }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[Edge:get-post-likers] Unexpected error:", err);
    return new Response(
      JSON.stringify({ error: "An unexpected error occurred" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
