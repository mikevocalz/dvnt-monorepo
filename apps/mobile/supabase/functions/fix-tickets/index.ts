import { createClient } from "jsr:@supabase/supabase-js@2";

Deno.serve(async (req) => {
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
