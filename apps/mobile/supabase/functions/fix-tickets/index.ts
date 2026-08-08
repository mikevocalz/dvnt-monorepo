import { createClient } from "jsr:@supabase/supabase-js@2";

Deno.serve(async (req) => {
  // ── Auth gate: internal admin job — x-internal-secret required ──────
  // One-off data-repair job that rewrites tickets.user_id with the service
  // role. Mirrors the payouts-release CRON_SECRET pattern: fail CLOSED when
  // the env is unset. (Operator script: scripts/run-ticket-fix.sh — send the
  // x-internal-secret header there.)
  const internalSecret = Deno.env.get("INTERNAL_FN_SECRET") || "";
  if (!internalSecret) {
    console.error("[fix-tickets] INTERNAL_FN_SECRET not set — rejecting request");
    return new Response(JSON.stringify({ error: "Misconfigured" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
  if ((req.headers.get("x-internal-secret") || "") !== internalSecret) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const supabaseClient = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${supabaseServiceKey}` } },
  });

  try {
    // Get all users to build ID mapping
    const { data: users, error: usersError } = await supabaseClient
      .from("users")
      .select("id, auth_id");

    if (usersError) throw usersError;

    const idMap = new Map<string, string>();
    (users || []).forEach((u) => {
      if (u.id && u.auth_id) {
        idMap.set(String(u.id), u.auth_id);
      }
    });

    // Get all tickets
    const { data: tickets, error: ticketsError } = await supabaseClient
      .from("tickets")
      .select("id, user_id, event_id");

    if (ticketsError) throw ticketsError;

    const updates: any[] = [];
    for (const ticket of tickets || []) {
      const userId = ticket.user_id;
      if (idMap.has(userId)) {
        const authId = idMap.get(userId)!;
        if (authId !== userId) {
          const { error } = await supabaseClient
            .from("tickets")
            .update({ user_id: authId })
            .eq("id", ticket.id);

          if (!error) {
            updates.push({
              ticket_id: ticket.id,
              event_id: ticket.event_id,
              old_user_id: userId,
              new_user_id: authId,
            });
          }
        }
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        updated: updates.length,
        details: updates,
      }),
      { headers: { "Content-Type": "application/json" } },
    );
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
