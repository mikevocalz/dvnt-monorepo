/**
 * Edge Function: user-settings
 * GET/UPSERT user settings (notifications, privacy, messages, likes/comments)
 * Uses Better Auth session verification via direct DB lookup.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifySessionDetailed } from "../_shared/verify-session.ts";
import { isSettingsObject, mergeSettings } from "./merge-settings.ts";

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

      const { data: profile, error: profileError } = await supabaseAdmin
        .from("users").select("is_private").eq("auth_id", authId).maybeSingle();
      if (profileError) return errorResponse("internal_error", "Failed to fetch privacy settings");
      const saved = isSettingsObject(data?.settings) ? data.settings : {};
      const privacy = isSettingsObject(saved.privacy) ? saved.privacy : {};
      const flag = privacy.privateAccount;
      const privateAccount = profile?.is_private === true || (flag != null && flag !== false && flag !== "false");
      return jsonResponse({
        ok: true,
        data: { settings: mergeSettings(saved, { privacy: { privateAccount } }) },
      });
    }

    if (action === "update") {
      if (!isSettingsObject(body.settings)) {
        return errorResponse("validation_error", "settings object is required");
      }
      if (body.settings.privacy !== undefined && (!isSettingsObject(body.settings.privacy)
        || (body.settings.privacy.privateAccount !== undefined && typeof body.settings.privacy.privateAccount !== "boolean"))) {
        return errorResponse("validation_error", "Privacy preferences must be an object and privateAccount must be boolean");
      }

      // Fetch existing settings first
      let { data: existing, error: readError } = await supabaseAdmin
        .from("user_settings")
        .select("settings")
        .eq("auth_id", authId)
        .single();

      // Do not overwrite saved privacy/notification preferences when the read
      // failed. A genuinely new member has no row and may use defaults.
      if (readError && readError.code !== "PGRST116") {
        console.error("[user-settings] UPDATE read error:", readError);
        return errorResponse("internal_error", "Could not load your saved settings");
      }

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

      // Compare-and-swap keeps rapid, concurrent sibling toggles from restoring
      // an older privacy object. A newly created row uses INSERT, never UPSERT,
      // so a simultaneous first update must reread instead of erasing it.
      for (let attempt = 0; attempt < 4; attempt += 1) {
        let baseSettings = isSettingsObject(existing?.settings) ? existing.settings : {};
        const privacyPatch = isSettingsObject(body.settings.privacy) ? body.settings.privacy : {};
        if (!Object.prototype.hasOwnProperty.call(privacyPatch, "privateAccount")) {
          // A legacy row may say Public while users.is_private still says
          // Private. A notification/sibling toggle is not a Public choice.
          // Normalize that saved preference before the atomic sync trigger can
          // see it. Reread on CAS retries rather than retaining an old verdict.
          const { data: profile, error: profileError } = await supabaseAdmin
            .from("users").select("is_private").eq("auth_id", authId).maybeSingle();
          if (profileError) return errorResponse("internal_error", "Failed to fetch privacy settings");
          const privacy = isSettingsObject(baseSettings.privacy) ? baseSettings.privacy : {};
          const flag = privacy.privateAccount;
          const privateAccount = profile?.is_private === true || (flag != null && flag !== false && flag !== "false");
          baseSettings = mergeSettings(baseSettings, { privacy: { privateAccount } });
        }
        const mergedSettings = mergeSettings(baseSettings, body.settings);
        const table = supabaseAdmin.from("user_settings");
        let write;
        if (existing) {
          const update = table.update({ settings: mergedSettings }).eq("auth_id", authId);
          write = existing.settings == null
            ? update.is("settings", null)
            : update.eq("settings", JSON.stringify(existing.settings));
        } else {
          write = table.insert({ auth_id: authId, settings: mergedSettings });
        }
        const { data, error } = await write.select("settings").maybeSingle();
        if (!error && data) {
          return jsonResponse({ ok: true, data: { settings: data.settings } });
        }
        // A missed compare-and-swap or first-write uniqueness race is safe to
        // retry against current preferences. Every other error stops the write.
        if (error && error.code !== "23505") {
          console.error("[user-settings] UPDATE error:", error);
          return errorResponse("internal_error", "Failed to save settings");
        }
        ({ data: existing, error: readError } = await supabaseAdmin
          .from("user_settings")
          .select("settings")
          .eq("auth_id", authId)
          .single());
        if (readError && readError.code !== "PGRST116") {
          return errorResponse("internal_error", "Could not load your saved settings");
        }
      }
      return errorResponse("conflict", "Your settings changed. Please try again.");
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
