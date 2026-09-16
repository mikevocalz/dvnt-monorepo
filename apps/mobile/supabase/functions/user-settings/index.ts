/**
 * Edge Function: user-settings
 * GET/UPSERT user settings (notifications, privacy, messages, likes/comments)
 * Uses Better Auth session verification via direct DB lookup.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifySessionDetailed } from "../_shared/verify-session.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, sentry-trace, baggage",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface ApiResponse<T = unknown> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

function jsonResponse<T>(data: ApiResponse<T>, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function errorResponse(code: string, message: string): Response {
  // Always return 200 so supabase.functions.invoke puts body in `data` (not `error`)
  return jsonResponse({ ok: false, error: { code, message } }, 200);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST")
    return errorResponse("validation_error", "Method not allowed");

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer "))
      return errorResponse(
        "unauthorized",
        "Missing or invalid Authorization header",
      );

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !supabaseServiceKey) {
      return errorResponse("internal_error", "Server configuration error");
    }
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${supabaseServiceKey}` } },
    });

    // Verify Better Auth session via shared helper
    const sessionResult = await verifySessionDetailed(supabaseAdmin, req);
    if (!sessionResult.ok) {
      if (sessionResult.reason === "expired") {
        return errorResponse("unauthorized", "Session expired");
      }
      return errorResponse("unauthorized", "Invalid or expired session");
    }

    const authUserId = sessionResult.userId;
    const authId = authUserId;

    let body: { action: "get" | "update"; settings?: Record<string, unknown> };
    try {
      body = await req.json();
    } catch {
      return errorResponse("validation_error", "Invalid JSON body");
    }

    const { action } = body;

    if (action === "get") {
      // Fetch user settings
      const { data, error } = await supabaseAdmin
        .from("user_settings")
        .select("settings")
        .eq("auth_id", authId)
        .single();

      if (error && error.code !== "PGRST116") {
        // PGRST116 = no rows found (new user, return defaults)
        console.error("[user-settings] GET error:", error);
        return errorResponse("internal_error", "Failed to fetch settings");
      }

      return jsonResponse({
        ok: true,
        data: { settings: data?.settings || {} },
      });
    }

    if (action === "update") {
      if (!body.settings || typeof body.settings !== "object") {
        return errorResponse("validation_error", "settings object is required");
      }

      // Fetch existing settings first
      const { data: existing } = await supabaseAdmin
        .from("user_settings")
        .select("settings")
        .eq("auth_id", authId)
        .single();

      // Deep merge: existing settings + new partial settings
      const mergedSettings = {
        ...(existing?.settings || {}),
        ...body.settings,
      };

      // Growth-message opt-out. Only brand campaigns in brand_message_outbox
      // read this; ticket email, receipts and order mail never route through
      // that outbox, so turning it off cannot stop somebody's ticket.
      if (typeof (body.settings as any).growthMessages === "boolean") {
        const { data: row } = await supabaseAdmin
          .from("users")
          .select("id")
          .eq("auth_id", authId)
          .maybeSingle();
        if (row?.id) {
          const { error: optOutError } = await supabaseAdmin.rpc(
            "set_brand_message_opt_out",
            {
              p_recipient_id: row.id,
              p_opted_out: !(body.settings as any).growthMessages,
              p_reason: "member_setting",
            },
          );
          if (optOutError) {
            console.error("[user-settings] opt-out failed:", optOutError);
            return errorResponse(
              "internal_error",
              "Could not save your message preference",
            );
          }
        }
      }

      // Upsert
      const { data, error } = await supabaseAdmin
        .from("user_settings")
        .upsert(
          {
            auth_id: authId,
            settings: mergedSettings,
          },
          { onConflict: "auth_id" },
        )
        .select("settings")
        .single();

      if (error) {
        console.error("[user-settings] UPSERT error:", error);
        return errorResponse("internal_error", "Failed to save settings");
      }

      return jsonResponse({
        ok: true,
        data: { settings: data?.settings || mergedSettings },
      });
    }

    return errorResponse(
      "validation_error",
      'Invalid action. Use "get" or "update".',
    );
  } catch (err) {
    console.error("[Edge:user-settings] Error:", err);
    return errorResponse("internal_error", "An unexpected error occurred");
  }
});
