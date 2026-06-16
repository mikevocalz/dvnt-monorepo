/**
 * Edge Function: get-following-ids
 * Fetch current user's following user IDs. Uses service role. Auth required.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveOrProvisionUser } from "../_shared/resolve-user.ts";
import { verifySession } from "../_shared/verify-session.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-auth-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

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
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !supabaseServiceKey) {
      console.error("[Edge:get-following-ids] Missing server config");
      return new Response(
        JSON.stringify({ followingIds: [], authoritative: false }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${supabaseServiceKey}` } },
    });

    const authUserId = await verifySession(supabaseAdmin, req);
    if (!authUserId) {
      console.error("[Edge:get-following-ids] Session unavailable");
      // Return empty array instead of 401 - prevents breaking messages UI
      return new Response(
        JSON.stringify({ followingIds: [], authoritative: false }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const userData = await resolveOrProvisionUser(supabaseAdmin, authUserId, "id");
    if (!userData) {
      return new Response(
        JSON.stringify({ followingIds: [], authoritative: false }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // Query follows table - follower_id should be the integer user.id
    console.log(
      "[Edge:get-following-ids] Querying follows for user.id:",
      userData.id,
    );

    const { data, error } = await supabaseAdmin
      .from("follows")
      .select("following_id")
      .eq("follower_id", userData.id);

    if (error) {
      console.error("[Edge:get-following-ids] Supabase error:", error);
      // Return empty array instead of 500 - prevents breaking messages UI
      return new Response(
        JSON.stringify({ followingIds: [], authoritative: false }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    console.log("[Edge:get-following-ids] Found follows:", data?.length || 0);

    // Convert to string array (following_id is integer in DB)
    const followingIds = (data || []).map((f: any) => String(f.following_id));

    return new Response(
      JSON.stringify({ followingIds, authoritative: true }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (err) {
    console.error("[Edge:get-following-ids] Unexpected error:", err);
    // Return empty array instead of 500 - prevents breaking messages UI
    return new Response(
      JSON.stringify({ followingIds: [], authoritative: false }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
