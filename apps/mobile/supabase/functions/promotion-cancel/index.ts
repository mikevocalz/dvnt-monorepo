/**
 * Promotion Cancel Edge Function (Option A Gateway)
 *
 * POST /promotion-cancel
 * Body: { campaign_id }
 *
 * Cancels a campaign owned by the authenticated caller.
 * Replaces direct client table write (deny-by-default enforcement).
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifySession as sharedVerifySession } from "../_shared/verify-session.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

Deno.serve(async (req: Request) => {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response("Method not allowed", {
      status: 405,
      headers: corsHeaders,
    });
  }

  try {
    const { campaign_id } = await req.json();

    if (!campaign_id) {
      return new Response(JSON.stringify({ error: "Missing campaign_id" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` } },
    });

    // Verify session — MANDATORY (Option A)
    const userId = await sharedVerifySession(supabase, req);
    if (!userId) {
      return new Response(
        JSON.stringify({ error: "Unauthorized — invalid or expired session" }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // Fetch campaign and verify ownership
    const { data: campaign, error: fetchError } = await supabase
      .from("event_spotlight_campaigns")
      .select("id, organizer_id, status")
      .eq("id", campaign_id)
      .single();

    if (fetchError || !campaign) {
      return new Response(JSON.stringify({ error: "Campaign not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (campaign.organizer_id !== userId) {
      return new Response(
        JSON.stringify({ error: "Forbidden — you do not own this campaign" }),
        {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // Only cancel if still active or pending
    if (!["active", "pending"].includes(campaign.status)) {
      return new Response(
        JSON.stringify({
          error: `Cannot cancel campaign with status '${campaign.status}'`,
        }),
        {
          status: 409,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // Cancel the campaign (service_role bypasses RLS)
    const { error: updateError } = await supabase
      .from("event_spotlight_campaigns")
      .update({ status: "cancelled" })
      .eq("id", campaign_id)
      .in("status", ["active", "pending"]); // CAS guard

    if (updateError) {
      console.error("[promotion-cancel] Update error:", updateError);
      return new Response(
        JSON.stringify({ error: "Failed to cancel campaign" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    console.log(
      "[promotion-cancel] Campaign cancelled:",
      campaign_id,
      "by:",
      userId,
    );

    return new Response(JSON.stringify({ success: true, campaign_id }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("[promotion-cancel] Error:", err);
    return new Response(
      JSON.stringify({ error: err.message || "Internal error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
