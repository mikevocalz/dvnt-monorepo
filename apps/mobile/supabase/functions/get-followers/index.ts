/**
 * Edge Function: get-followers
 * Fetch followers for a user with isFollowing for current viewer. Uses service role.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveOrProvisionUser } from "../_shared/resolve-user.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface FollowerDoc {
  id: string;
  username: string;
  name: string;
  avatar: string;
  verified: boolean;
  isFollowing: boolean;
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
    const body = await req.json().catch(() => ({}));
    const userId = body?.userId != null ? String(body.userId) : null;
    const page = Math.max(1, Number(body?.page) || 1);
    const limit = Math.min(Math.max(Number(body?.limit) || 20, 1), 50);
    const offset = (page - 1) * limit;

    if (!userId) {
      return new Response(JSON.stringify({ error: "userId is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userIdInt = parseInt(userId);
    if (isNaN(userIdInt)) {
      return new Response(JSON.stringify({ error: "Invalid userId" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !supabaseServiceKey) {
      return new Response(JSON.stringify({ error: "Server configuration error" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${supabaseServiceKey}` } },
    });

    let viewerFollowingIds: number[] = [];
    const authHeader = req.headers.get("Authorization");
    if (authHeader?.startsWith("Bearer ")) {
      const token = authHeader.replace("Bearer ", "");
      const { data: sessionData } = await supabaseAdmin
        .from("session")
        .select("userId, expiresAt")
        .eq("token", token)
        .single();
      if (sessionData && new Date(sessionData.expiresAt) >= new Date()) {
        const userData = await resolveOrProvisionUser(
          supabaseAdmin,
          sessionData.userId,
          "id",
        );
        if (userData) {
          const { data: followingData } = await supabaseAdmin
            .from("follows")
            .select("following_id")
            .eq("follower_id", userData.id);
          viewerFollowingIds = (followingData || []).map(
            (f: any) => f.following_id,
          );
        }
      }
    }

    const { data, error, count } = await supabaseAdmin
      .from("follows")
      .select(
        `
        follower:follower_id(id, username, first_name, verified, avatar:avatar_id(url))
      `,
        { count: "exact" },
      )
      .eq("following_id", userIdInt)
      .range(offset, offset + limit - 1);

    if (error) {
      console.error("[Edge:get-followers] Supabase error:", error);
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const docs: FollowerDoc[] = (data || []).map((f: any) => {
      const follower = f.follower;
      const followerId = follower?.id;
      return {
        id: String(followerId),
        username: follower?.username || "unknown",
        name: follower?.first_name || follower?.username || "Unknown",
        avatar: follower?.avatar?.url || "",
        verified: follower?.verified || false,
        isFollowing: followerId ? viewerFollowingIds.includes(followerId) : false,
      };
    });

    const totalDocs = count ?? 0;
    return new Response(
      JSON.stringify({
        docs,
        totalDocs,
        hasNextPage: offset + limit < totalDocs,
        page,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (err) {
    console.error("[Edge:get-followers] Unexpected error:", err);
    return new Response(
      JSON.stringify({ error: "An unexpected error occurred" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
