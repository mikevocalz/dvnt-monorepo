/**
 * Owner/admin-only promo-code removal. Delete means revoke for new purchases;
 * keep rows for already placed orders, tax/reconciliation, and refund history.
 *
 * POST /manage-promo-code { action: "delete", promo_id }
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  verifySession,
  corsHeaders,
  optionsResponse,
} from "../_shared/verify-session.ts";
import { withSentry } from "../_shared/sentry.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

function json(req: Request, data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders(req), "Content-Type": "application/json" },
  });
}

Deno.serve(withSentry("manage-promo-code", async (req: Request) => {
  if (req.method === "OPTIONS") return optionsResponse();
  if (req.method !== "POST") {
    return json(req, { error: "Method not allowed" }, 405);
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` } },
    });

    const authId = await verifySession(supabase, req);
    if (!authId) return json(req, { error: "Unauthorized" }, 401);

    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return json(req, { error: "Invalid request" }, 400);
    }
    if (body.action !== "delete" || typeof body.promo_id !== "string" ||
        !/^[0-9a-f-]{36}$/i.test(body.promo_id)) {
      return json(req, { error: "Invalid promo code deletion request" }, 400);
    }

    const { data: promo, error: readError } = await supabase
      .from("promo_codes")
      .select("id, event_id, deleted_at")
      .eq("id", body.promo_id)
      .maybeSingle();
    if (readError) {
      console.error("[manage-promo-code] lookup failed:", readError);
      return json(req, { error: "Could not load promo code" }, 500);
    }
    if (!promo) return json(req, { error: "Promo code not found" }, 404);

    const { data: event, error: eventError } = await supabase
      .from("events")
      .select("host_id")
      .eq("id", promo.event_id)
      .maybeSingle();
    if (eventError || !event) {
      return json(req, { error: "Event not found" }, 404);
    }

    let authorized = String(event.host_id) === String(authId);
    if (!authorized) {
      const { data: coOrganizer, error: roleError } = await supabase
        .from("event_co_organizers")
        .select("id")
        .eq("event_id", promo.event_id)
        .eq("user_id", authId)
        .eq("accepted", true)
        .eq("role", "admin")
        .maybeSingle();
      if (roleError) {
        console.error("[manage-promo-code] role lookup failed:", roleError);
        return json(req, { error: "Could not verify permissions" }, 500);
      }
      authorized = !!coOrganizer;
    }
    if (!authorized) return json(req, { error: "Forbidden" }, 403);
    if (promo.deleted_at) return json(req, { ok: true, alreadyDeleted: true });

    // Do not delete physically: orders.promo_code_id may reference this row.
    // Guard against concurrent deletes so the operation is idempotent.
    const { error: revokeError } = await supabase
      .from("promo_codes")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", promo.id)
      .eq("event_id", promo.event_id)
      .is("deleted_at", null);
    if (revokeError) {
      console.error("[manage-promo-code] revoke failed:", revokeError);
      return json(req, { error: "Could not delete promo code" }, 500);
    }

    return json(req, { ok: true });
  } catch (error) {
    console.error("[manage-promo-code] unexpected error:", error);
    return json(req, { error: "Could not delete promo code" }, 500);
  }
}));
