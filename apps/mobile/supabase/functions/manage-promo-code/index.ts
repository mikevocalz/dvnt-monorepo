/**
 * Event promo creation and owner/admin-only removal. Delete means revoke for new purchases;
 * keep rows for already placed orders, tax/reconciliation, and refund history.
 *
 * POST /manage-promo-code { action: "delete", promo_id }
 * POST /manage-promo-code { action: "create", event_id, code, discount_type, discount_value, max_uses? }
 * Creation accepts the owner or an accepted admin/editor; no direct client INSERT or payout access.
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
    if (!body || typeof body !== "object" || !["create", "delete"].includes(String(body.action))) {
      return json(req, { error: "Invalid promo code request" }, 400);
    }
    const creating = body.action === "create";
    let eventId: number;
    let promo: { id: string; event_id: number; deleted_at: string | null } | null = null;
    let createData: Record<string, unknown> | null = null;
    if (creating) {
      const code = typeof body.code === "string" ? body.code.trim().toUpperCase() : "";
      const value = body.discount_value;
      const maxUses = body.max_uses ?? null;
      if (!Number.isSafeInteger(body.event_id) || Number(body.event_id) <= 0 ||
          !/^[A-Z0-9_-]{1,64}$/.test(code) ||
          !["percent", "fixed_cents"].includes(String(body.discount_type)) ||
          !Number.isSafeInteger(value) || Number(value) <= 0 || Number(value) > 2147483647 ||
          (body.discount_type === "percent" && Number(value) > 100) ||
          (maxUses !== null && (!Number.isSafeInteger(maxUses) || Number(maxUses) <= 0 || Number(maxUses) > 2147483647))) {
        return json(req, { error: "Enter a valid code, whole-number discount and usage limit" }, 400);
      }
      eventId = Number(body.event_id);
      // Explicit server-owned fields: client values cannot forge attribution,
      // usage counters, ticket scope, validity windows or revocation state.
      createData = {
        event_id: eventId, code, discount_type: body.discount_type,
        discount_value: value, max_uses: maxUses, created_by: authId, uses_count: 0,
      };
    } else {
      if (typeof body.promo_id !== "string" || !/^[0-9a-f-]{36}$/i.test(body.promo_id)) {
        return json(req, { error: "Invalid promo code deletion request" }, 400);
      }
      const { data, error: readError } = await supabase
        .from("promo_codes")
        .select("id, event_id, deleted_at")
        .eq("id", body.promo_id)
        .maybeSingle();
      if (readError) {
        console.error("[manage-promo-code] lookup failed:", readError);
        return json(req, { error: "Could not load promo code" }, 500);
      }
      if (!data) return json(req, { error: "Promo code not found" }, 404);
      promo = data;
      eventId = data.event_id;
    }

    const { data: event, error: eventError } = await supabase
      .from("events")
      .select("host_id")
      .eq("id", eventId)
      .maybeSingle();
    if (eventError || !event) {
      return json(req, { error: "Event not found" }, 404);
    }

    let authorized = String(event.host_id) === String(authId);
    if (!authorized) {
      const { data: coOrganizer, error: roleError } = await supabase
        .from("event_co_organizers")
        .select("id")
        .eq("event_id", eventId)
        .eq("user_id", authId)
        .eq("accepted", true)
        .in("role", creating ? ["admin", "editor"] : ["admin"])
        .maybeSingle();
      if (roleError) {
        console.error("[manage-promo-code] role lookup failed:", roleError);
        return json(req, { error: "Could not verify permissions" }, 500);
      }
      authorized = !!coOrganizer;
    }
    if (!authorized) return json(req, { error: creating
      ? "Only the event host or an accepted co-host/editor can create promo codes"
      : "Only the event host or an accepted admin can delete promo codes" }, 403);

    if (creating) {
      const { data: created, error: createError } = await supabase
        .from("promo_codes").insert(createData).select("id, code").single();
      if (createError?.code === "23505") {
        return json(req, { error: "This code already exists", code: "promo_code_exists" }, 409);
      }
      if (createError || !created?.id) {
        console.error("[manage-promo-code] create failed:", createError);
        return json(req, { error: "Could not create promo code" }, 500);
      }
      return json(req, { ok: true, promo: created });
    }
    if (!promo) return json(req, { error: "Promo code not found" }, 404);
    if (promo.deleted_at) return json(req, { ok: true, alreadyDeleted: true });

    // Do not delete physically: orders.promo_code_id may reference this row.
    // Also expire the code for already-deployed checkout functions, which
    // enforce valid_until but have not yet received the deleted_at filter.
    // This makes a staggered deployment safe without rewriting order history.
    const now = new Date();
    const expiredAt = new Date(now.getTime() - 1000).toISOString();
    const { error: revokeError } = await supabase
      .from("promo_codes")
      .update({ deleted_at: now.toISOString(), valid_until: expiredAt })
      .eq("id", promo.id)
      .eq("event_id", eventId)
      .is("deleted_at", null);
    if (revokeError) {
      console.error("[manage-promo-code] revoke failed:", revokeError);
      return json(req, { error: "Could not delete promo code" }, 500);
    }

    return json(req, { ok: true });
  } catch (error) {
    console.error("[manage-promo-code] unexpected error:", error);
    return json(req, { error: "Could not manage promo code" }, 500);
  }
}));
