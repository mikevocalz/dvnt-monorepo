import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifySession, corsHeaders, optionsResponse } from "../_shared/verify-session.ts";

const URL = Deno.env.get("SUPABASE_URL") || "";
const KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

function json(req: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return optionsResponse();
  if (req.method !== "POST") return json(req, { ok:false, error:"Method not allowed" }, 405);
  const supabase = createClient(URL, KEY, { auth:{ persistSession:false, autoRefreshToken:false }});
  const authId = await verifySession(supabase, req);
  if (!authId) return json(req, { ok:false, error:"Unauthorized" }, 401);

  const body = await req.json().catch(() => ({}));
  const source = Number(body.source_event_id);
  const destination = Number(body.destination_event_id);
  if (!Number.isInteger(source) || !Number.isInteger(destination) || source <= 0 || destination <= 0) {
    return json(req, { ok:false, error:"Valid source_event_id and destination_event_id are required" }, 400);
  }

  const { data: sourceEvent } = await supabase.from("events")
    .select("host_id").eq("id", source).maybeSingle();
  const ownsSource = String(sourceEvent?.host_id || "") === String(authId);
  if (!ownsSource) {
    const { data: admin } = await supabase.from("event_co_organizers")
      .select("user_id").eq("event_id", source).eq("user_id", authId)
      .eq("accepted", true).eq("role", "admin").maybeSingle();
    if (!admin) return json(req, { ok:false, error:"Forbidden" }, 403);
  }

  if (body.mode === "preflight") {
    const { data, error } = await supabase.rpc("event_consolidation_snapshot", {
      p_source_event_id: source,
      p_destination_event_id: destination,
    });
    if (error) return json(req, { ok:false, error:error.message }, 500);
    return json(req, { ok:true, data });
  }

  if (body.mode === "execute") {
    if (!body.operation_id || !body.expected_preflight_hash || !body.ticket_type_map) {
      return json(req, { ok:false, error:"operation_id, expected_preflight_hash and ticket_type_map are required" }, 400);
    }
    const { data, error } = await supabase.rpc("execute_event_consolidation", {
      p_source_event_id: source,
      p_destination_event_id: destination,
      p_actor_auth_id: authId,
      p_operation_id: body.operation_id,
      p_expected_preflight_hash: body.expected_preflight_hash,
      p_ticket_type_map: body.ticket_type_map,
    });
    if (error) return json(req, { ok:false, error:error.message }, 500);
    return json(req, data, data?.ok ? 200 : 409);
  }

  return json(req, { ok:false, error:"mode must be preflight or execute" }, 400);
});
