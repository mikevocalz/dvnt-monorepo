import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        headers: { Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
      },
    },
  );

  // Get existing auth_ids in users table
  const { data: existing } = await supabase.from("users").select("auth_id");
  const existingIds = new Set(
    (existing || []).map((u: any) => u.auth_id).filter(Boolean),
  );
  const existingUsernames = new Set<string>();
  const { data: allUsers } = await supabase.from("users").select("username");
  for (const u of allUsers || [])
    if (u.username) existingUsernames.add(u.username);

  // Get all Better Auth users
  const { data: authUsers, error } = await supabase
    .from("user")
    .select("id, name, email, image, createdAt")
    .order("createdAt", { ascending: false });

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const TEST_EMAILS = ["@test.com", "@example.com", "@deviant.test"];
  const SKIP_NAMES = ["mike test"];

  const missing = (authUsers || []).filter((u: any) => {
    if (existingIds.has(u.id)) return false;
    const email = (u.email || "").toLowerCase();
    if (TEST_EMAILS.some((t) => email.endsWith(t))) return false;
    const name = (u.name || "").trim().toLowerCase();
    if (!name || name.startsWith("test") || SKIP_NAMES.includes(name))
      return false;
    return true;
  });

  // Get max existing ID to continue sequence
  const { data: maxRow } = await supabase
    .from("users")
    .select("id")
    .order("id", { ascending: false })
    .limit(1)
    .single();
  let nextId = (maxRow?.id || 0) + 1;

  const results: any[] = [];

  for (const u of missing) {
    const displayName = (u.name || "").trim();
    const parts = displayName.split(/\s+/);
    let username =
      parts
        .map((p: string) => p.toLowerCase().replace(/[^a-z0-9]/g, ""))
        .filter(Boolean)
        .join("_") || u.id.slice(0, 12);

    // Deduplicate username
    let base = username;
    let counter = 1;
    while (existingUsernames.has(username)) {
      username = `${base}${counter}`;
      counter++;
    }
    existingUsernames.add(username);

    const { error: insertError } = await supabase.from("users").insert({
      id: nextId++,
      auth_id: u.id,
      username,
      email: u.email,
      first_name: parts[0] || "",
      last_name: parts.slice(1).join(" ") || null,
      verified: false,
      followers_count: 0,
      following_count: 0,
      posts_count: 0,
      is_private: false,
    });

    results.push({
      username,
      name: displayName,
      email: u.email,
      ok: !insertError,
      error: insertError?.message,
    });
  }

  return new Response(
    JSON.stringify({ total: missing.length, results }, null, 2),
    {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    },
  );
});
