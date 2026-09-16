import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifySession, corsHeaders, optionsResponse } from "../_shared/verify-session.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return optionsResponse();
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders(req), "Content-Type": "application/json" },
  });
  if (req.method !== "POST") return json({ ok: false, error: { message: "Method not allowed" } }, 405);
  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const actor = await verifySession(admin, req);
    if (!actor) return json({ ok: false, error: { message: "Invalid or expired session" } }, 401);
    const body = await req.json().catch(() => null);
    const id = Number(body?.eventId);
    if (!Number.isSafeInteger(id) || id <= 0) {
      return json({ ok: false, error: { message: "Valid event ID is required" } }, 400);
    }
    const { data, error } = await admin.rpc("delete_event_guarded", { p_event_id: id, p_actor_auth_id: actor });
    if (error) {
      console.error("[delete-event] transaction failed", error.code);
      return json({ ok: false, error: { message: "Event could not be deleted. Nothing was removed. Please try again." } }, 500);
    }
    if (!data?.ok) {
      // Keep structured application errors in the envelope read by invokeEdge.
      return json({ ok: false, error: { code: data?.code, message: data?.message || "Event could not be deleted" } });
    }
    return json({ ok: true, data: { eventId: String(data.eventId) } });
  } catch {
    return json({ ok: false, error: { message: "Unable to delete event" } }, 500);
  }
});
