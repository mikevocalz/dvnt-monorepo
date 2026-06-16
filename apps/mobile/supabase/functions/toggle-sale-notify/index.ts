/**
 * toggle-sale-notify Edge Function
 *
 * POST /toggle-sale-notify
 * Body: { event_id: number, enabled: boolean }
 *
 * Inserts or removes a row in sale_notify_subscriptions for the
 * authenticated user. Returns { subscribed: boolean } so the client can
 * confirm its local optimistic state.
 *
 * Better Auth tokens — deploy with --no-verify-jwt.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifySession } from "../_shared/verify-session.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, x-auth-token",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...cors },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS")
    return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` } },
    });

    const authUserId = await verifySession(supabase, req);
    if (!authUserId) return json({ error: "Unauthorized" }, 401);

    const { event_id, enabled } = await req.json();
    if (!event_id || typeof enabled !== "boolean") {
      return json({ error: "Missing event_id or enabled" }, 400);
    }

    // sale_notify_subscriptions.user_id is INTEGER (the app users table),
    // not the Better Auth string id. Resolve it.
    const { data: userRow, error: userErr } = await supabase
      .from("users")
      .select("id")
      .eq("auth_id", authUserId)
      .maybeSingle();
    if (userErr || !userRow) {
      console.error("[toggle-sale-notify] No users row for auth:", authUserId);
      return json({ error: "User profile not found" }, 404);
    }
    const userIdInt = userRow.id as number;
    const eventIdInt = Number(event_id);
    if (!Number.isFinite(eventIdInt)) {
      return json({ error: "Invalid event_id" }, 400);
    }

    if (enabled) {
      // Idempotent insert. On conflict, leave existing row untouched so we
      // don't clobber notified_at if a re-subscribe happens after delivery.
      const { error: insErr } = await supabase
        .from("sale_notify_subscriptions")
        .upsert(
          { user_id: userIdInt, event_id: eventIdInt },
          { onConflict: "event_id,user_id", ignoreDuplicates: true },
        );
      if (insErr) {
        console.error("[toggle-sale-notify] Insert error:", insErr);
        return json({ error: insErr.message }, 500);
      }
      return json({ subscribed: true, event_id: eventIdInt });
    } else {
      const { error: delErr } = await supabase
        .from("sale_notify_subscriptions")
        .delete()
        .eq("event_id", eventIdInt)
        .eq("user_id", userIdInt);
      if (delErr) {
        console.error("[toggle-sale-notify] Delete error:", delErr);
        return json({ error: delErr.message }, 500);
      }
      return json({ subscribed: false, event_id: eventIdInt });
    }
  } catch (err: any) {
    console.error("[toggle-sale-notify] Error:", err);
    return json({ error: err.message || "Internal error" }, 500);
  }
});
