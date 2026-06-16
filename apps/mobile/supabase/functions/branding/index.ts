/**
 * Branding Edge Function
 *
 * POST /branding
 * Body: { action: "get" | "update", display_name?, fallback_text?, logo_url?, logo_monochrome_url? }
 *
 * Manages organizer branding for receipts/invoices/tickets.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  verifySession,
  jsonResponse,
  errorResponse,
  optionsResponse,
} from "../_shared/verify-session.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return optionsResponse();
  if (req.method !== "POST") return errorResponse("Method not allowed", 405);

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` } },
    });
    const userId = await verifySession(supabase, req);
    if (!userId) return errorResponse("Unauthorized", 401);

    const body = await req.json();
    const { action } = body;

    switch (action) {
      case "get": {
        const { data: branding } = await supabase
          .from("organizer_branding")
          .select("*")
          .eq("host_id", userId)
          .single();

        if (!branding) {
          return jsonResponse(null);
        }

        return jsonResponse({
          hostId: branding.host_id,
          logoUrl: branding.logo_url,
          logoMonochromeUrl: branding.logo_monochrome_url,
          displayName: branding.display_name,
          fallbackText: branding.fallback_text,
          updatedAt: branding.updated_at,
        });
      }

      case "update": {
        const { display_name, fallback_text, logo_url, logo_monochrome_url } =
          body;

        const updateData: Record<string, any> = {
          host_id: userId,
          updated_at: new Date().toISOString(),
        };

        if (display_name !== undefined) updateData.display_name = display_name;
        if (fallback_text !== undefined)
          updateData.fallback_text = fallback_text;
        if (logo_url !== undefined) updateData.logo_url = logo_url;
        if (logo_monochrome_url !== undefined)
          updateData.logo_monochrome_url = logo_monochrome_url;

        const { error } = await supabase
          .from("organizer_branding")
          .upsert(updateData, { onConflict: "host_id" });

        if (error) throw error;

        return jsonResponse({ success: true });
      }

      default:
        return errorResponse(`Unknown action: ${action}`);
    }
  } catch (err: any) {
    console.error("[branding] Error:", err);
    return errorResponse(err.message || "Internal error", 500);
  }
});
