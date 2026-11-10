/**
 * Edge Function: get-following
 * Fetch following list for a user with isFollowing for current viewer. Uses service role.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifySession } from "../_shared/verify-session.ts";
import { resolveOrProvisionUser } from "../_shared/resolve-user.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, sentry-trace, baggage",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface FollowingDoc {
  id: string;
  username: string;
  name: string;
  avatar: string;
  verified: boolean;
  isFollowing: boolean;
  followsYou: boolean;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "private, no-store" },
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
        headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "private, no-store" },
      });
    }

    const userIdInt = parseInt(userId);
    if (isNaN(userIdInt)) {
      return new Response(JSON.stringify({ error: "Invalid userId" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "private, no-store" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !supabaseServiceKey) {
      return new Response(JSON.stringify({ error: "Server configuration error" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "private, no-store" },
      });
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${supabaseServiceKey}` } },
    });

    let viewerUserId: number | null = null;
    const viewerAuthId = await verifySession(supabaseAdmin, req);
    if (viewerAuthId) {
      const userData = await resolveOrProvisionUser(supabaseAdmin, viewerAuthId, "id");
      if (userData) viewerUserId = Number(userData.id);
    }
    // The service-only RPC authorizes and projects the list in one snapshot.
    // Never use a caller-supplied viewer ID or a separate preflight read.
    const { data, error } = await supabaseAdmin.rpc("get_profile_social_graph", {
      p_viewer: viewerUserId, p_target: userIdInt, p_direction: "following",
      p_limit: limit, p_offset: offset,
    });
    if (error || !data) throw new Error("Could not load follow list");
    if (data.allowed !== true) {
      return new Response(JSON.stringify({ error: "This account's follow list is private" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "private, no-store" },
      });
    }
    const docs: FollowingDoc[] = data.docs || [];
    const totalDocs = data.totalDocs ?? 0;
    return new Response(
      JSON.stringify({
        docs,
        totalDocs,
        hasNextPage: offset + limit < totalDocs,
        page,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "private, no-store" },
      },
    );
  } catch (err) {
    console.error("[Edge:get-following] Unexpected error:", err);
    return new Response(
      JSON.stringify({ error: "An unexpected error occurred" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
