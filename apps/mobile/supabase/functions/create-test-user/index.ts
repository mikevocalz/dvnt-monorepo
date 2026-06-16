/**
 * Edge Function: create-test-user
 * Creates a test user account for Apple review
 * This is a one-time use function for app store review purposes
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
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
  return jsonResponse({ ok: false, error: { code, message } }, 200);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return errorResponse("validation_error", "Method not allowed");
  }

  try {
    let body: {
      secret: string;
      email: string;
      username: string;
      password: string;
      name: string;
    };
    try {
      body = await req.json();
    } catch {
      return errorResponse("validation_error", "Invalid JSON body");
    }

    const { secret, email, username, password, name } = body;

    // Simple secret check to prevent abuse
    if (secret !== "apple-review-2024-dvnt") {
      return errorResponse("unauthorized", "Invalid secret");
    }

    if (!email || !username || !password || !name) {
      return errorResponse("validation_error", "Missing required fields");
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseServiceKey) {
      return errorResponse("internal_error", "Server configuration error");
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${supabaseServiceKey}` } },
    });

    // Check if user already exists
    const { data: existingUser } = await supabaseAdmin
      .from("users")
      .select("id, email, username")
      .or(`email.eq.${email},username.eq.${username}`)
      .single();

    if (existingUser) {
      return jsonResponse({
        ok: true,
        data: {
          message: "Test user already exists",
          user: {
            id: existingUser.id,
            email: existingUser.email,
            username: existingUser.username,
          },
        },
      });
    }

    // Create the test user in Supabase users table
    const { data: newUser, error: createError } = await supabaseAdmin
      .from("users")
      .insert({
        auth_id: `apple-review-${Date.now()}`,
        email: email,
        username: username,
        first_name: name.split(" ")[0] || name,
        last_name: name.split(" ").slice(1).join(" ") || "",
        verified: true,
        followers_count: 0,
        following_count: 0,
        posts_count: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .select("id, email, username, first_name, last_name")
      .single();

    if (createError) {
      console.error(
        "[Edge:create-test-user] Failed to create user:",
        createError,
      );
      return errorResponse(
        "internal_error",
        `Failed to create user: ${createError.message}`,
      );
    }

    console.log("[Edge:create-test-user] Created test user:", newUser.id);

    return jsonResponse({
      ok: true,
      data: {
        message: "Test user created successfully",
        user: newUser,
        credentials: {
          email: email,
          password: password,
          note: "Use these credentials to sign in via Better Auth on the app",
        },
      },
    });
  } catch (err) {
    console.error("[Edge:create-test-user] Unexpected error:", err);
    return errorResponse("internal_error", "An unexpected error occurred");
  }
});
