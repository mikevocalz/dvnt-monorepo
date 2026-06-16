/**
 * Edge Function: get-story-viewers
 * Fetch all users who viewed a story. Uses service role to bypass RLS.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface ViewerRow {
  userId: number;
  username: string;
  avatar: string;
  viewedAt: string;
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
    const storyId = body?.storyId != null ? String(body.storyId) : null;
    if (!storyId) {
      return new Response(JSON.stringify({ error: "storyId is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const storyIdInt = parseInt(storyId);
    if (isNaN(storyIdInt)) {
      return new Response(JSON.stringify({ error: "Invalid storyId" }), {
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

    const { data, error } = await supabaseAdmin
      .from("story_views")
      .select(
        `
        user_id,
        viewed_at,
        user:user_id(id, username, first_name, avatar:avatar_id(url))
      `,
      )
      .eq("story_id", storyIdInt)
      .order("viewed_at", { ascending: false })
      .limit(500);

    if (error) {
      console.error("[Edge:get-story-viewers] Supabase error:", error);
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const viewers: ViewerRow[] = (data || []).map((row: any) => ({
      userId: row.user_id,
      username: row.user?.username || "unknown",
      avatar: row.user?.avatar?.url || "",
      viewedAt: row.viewed_at || row.viewedAt || row.created_at || "",
    }));

    return new Response(JSON.stringify({ viewers }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[Edge:get-story-viewers] Unexpected error:", err);
    return new Response(
      JSON.stringify({ error: "An unexpected error occurred" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
