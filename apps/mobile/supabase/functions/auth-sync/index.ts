/**
 * Edge Function: auth-sync
 *
 * Syncs Better Auth user to Supabase users table.
 * Called after login to ensure we have a valid users row with auth_id.
 *
 * Flow:
 * 1. Verify Better Auth token
 * 2. Check if user exists by auth_id
 * 3. If not, check by email and update auth_id
 * 4. If not, create new user row
 * 5. Return the user row
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  resolveBrandSender,
  verifyBrandSender,
} from "../_shared/brand-sender.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, sentry-trace, baggage",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type ErrorCode = "unauthorized" | "validation_error" | "internal_error";

interface ApiResponse<T = unknown> {
  ok: boolean;
  data?: T;
  error?: { code: ErrorCode; message: string };
}

function jsonResponse<T>(data: ApiResponse<T>, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function errorResponse(
  code: ErrorCode,
  message: string,
  status = 400,
): Response {
  console.error(`[Edge:auth-sync] Error: ${code} - ${message}`);
  return jsonResponse({ ok: false, error: { code, message } }, 200);
}

async function applyBrandOnboarding(
  supabaseAdmin: any,
  member: { id: number | string; auth_id?: string | null },
): Promise<void> {
  const authId = String(member.auth_id ?? "").trim();
  const memberId = Number(member.id);
  if (!authId || !Number.isSafeInteger(memberId) || memberId <= 0) return;

  // Queue exactly-once onboarding campaigns even when sending is disabled.
  // The outbox is allowed to fill safely; the worker still fails closed.
  const { error: enqueueError } = await supabaseAdmin.rpc("enqueue_brand_onboarding", {
    p_auth_id: authId,
    p_lookback: "7 days",
    p_first_post_delay: "24 hours",
  });
  if (enqueueError) {
    console.error("[Edge:auth-sync] brand onboarding enqueue failed:", enqueueError.message);
  }

  // Automatic follow relationships need the real brand account. Never guess
  // from @username: prove the configured public.users.id + auth_id pair first.
  const configured = resolveBrandSender();
  const verified = configured.ok
    ? await verifyBrandSender(supabaseAdmin, configured.sender)
    : configured;
  if (!verified.ok) {
    console.warn("[Edge:auth-sync] brand follow skipped:", verified.reason);
    return;
  }

  const { error: followError } = await supabaseAdmin.rpc(
    "ensure_brand_follow_relationships",
    {
      p_member_id: memberId,
      p_brand_id: verified.sender.userId,
      p_bidirectional: true,
    },
  );
  if (followError) {
    console.error("[Edge:auth-sync] brand follow failed:", followError.message);
  }
}

function normalizeLinks(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 4);
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return [];

    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return normalizeLinks(parsed);
      }
    } catch {
      return [trimmed];
    }
  }

  return [];
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return errorResponse("validation_error", "Method not allowed");
  }

  try {
    // 1. Extract and validate Authorization header
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return errorResponse(
        "unauthorized",
        "Missing or invalid Authorization header",
        401,
      );
    }

    const token = authHeader.replace("Bearer ", "");
    console.log("[Edge:auth-sync] Received sync request");

    // 2. Create Supabase admin client (needed for both session verification and user sync)
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseServiceKey) {
      console.error("[Edge:auth-sync] Missing Supabase environment variables");
      return errorResponse("internal_error", "Server configuration error");
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${supabaseServiceKey}` } },
    });

    // 3. Verify Better Auth session via direct DB lookup
    const { data: sessionData, error: sessionError } = await supabaseAdmin
      .from("session")
      .select("id, token, userId, expiresAt")
      .eq("token", token)
      .single();

    if (sessionError || !sessionData) {
      return errorResponse("unauthorized", "Invalid or expired session");
    }
    if (new Date(sessionData.expiresAt) < new Date()) {
      return errorResponse("unauthorized", "Session expired");
    }

    const authId = sessionData.userId;

    // Fetch email and name from Better Auth user table (needed for user creation/sync)
    const { data: baUser, error: baUserError } = await supabaseAdmin
      .from("user")
      .select("id, email, name, image, username")
      .eq("id", authId)
      .single();

    if (baUserError || !baUser) {
      console.error(
        "[Edge:auth-sync] Better Auth user lookup failed:",
        authId,
        baUserError?.message,
      );
      return errorResponse("unauthorized", "User account not found");
    }

    const email = baUser.email;
    const name = baUser.name || "";
    const baUsername = baUser.username || ""; // Username from Better Auth (set during signup)

    console.log("[Edge:auth-sync] Syncing user:", { authId, email });

    // 4. Try to find user by auth_id first
    let { data: existingUser, error: findError } = await supabaseAdmin
      .from("users")
      .select(
        `
        id,
        auth_id,
        email,
        username,
        first_name,
        last_name,
        bio,
        location,
        website,
        links,
        pronouns,
        gender,
        sexuality,
        event_audience,
        verified,
        followers_count,
        following_count,
        posts_count,
        avatar:avatar_id(url)
      `,
      )
      .eq("auth_id", authId)
      .single();

    if (existingUser) {
      console.log("[Edge:auth-sync] Found user by auth_id:", existingUser.id);
      await applyBrandOnboarding(supabaseAdmin, existingUser);
      return jsonResponse({
        ok: true,
        data: {
          user: formatUserResponse(existingUser),
          action: "found_by_auth_id",
        },
      });
    }

    // 5. Try to find by email and update auth_id
    const { data: userByEmail, error: emailError } = await supabaseAdmin
      .from("users")
      .select(
        `
        id,
        auth_id,
        email,
        username,
        first_name,
        last_name,
        bio,
        location,
        website,
        links,
        pronouns,
        gender,
        sexuality,
        event_audience,
        verified,
        followers_count,
        following_count,
        posts_count,
        avatar:avatar_id(url)
      `,
      )
      .eq("email", email)
      .single();

    if (userByEmail) {
      console.log(
        "[Edge:auth-sync] Found user by email, updating auth_id:",
        userByEmail.id,
      );

      // Update auth_id
      const { error: updateError } = await supabaseAdmin
        .from("users")
        .update({ auth_id: authId, updated_at: new Date().toISOString() })
        .eq("id", userByEmail.id);

      if (updateError) {
        console.error(
          "[Edge:auth-sync] Failed to update auth_id:",
          updateError,
        );
        return errorResponse("internal_error", "Failed to sync user");
      }

      const syncedUser = { ...userByEmail, auth_id: authId };
      await applyBrandOnboarding(supabaseAdmin, syncedUser);
      return jsonResponse({
        ok: true,
        data: {
          user: formatUserResponse(syncedUser),
          action: "updated_auth_id",
        },
      });
    }

    // 6. Create new user
    console.log("[Edge:auth-sync] Creating new user for:", email);

    // Use username from Better Auth if available (set during signup),
    // otherwise generate a fallback from email
    let username = baUsername;
    if (!username) {
      const baseUsername = email
        .split("@")[0]
        .replace(/[^a-zA-Z0-9_]/g, "")
        .toLowerCase();
      username = `${baseUsername}${Math.floor(Math.random() * 1000)}`;
    }

    // Ensure username is unique — if taken, append random digits
    const { data: existingUsername } = await supabaseAdmin
      .from("users")
      .select("id")
      .eq("username", username)
      .maybeSingle();

    if (existingUsername) {
      username = `${username}${Math.floor(Math.random() * 10000)}`;
      console.log("[Edge:auth-sync] Username taken, using fallback:", username);
    }

    console.log("[Edge:auth-sync] Using username:", username);

    // users.id uses a SEQUENCE (users_id_seq) — omit id to let the DB assign it
    const { data: newUser, error: createError } = await supabaseAdmin
      .from("users")
      .insert({
        auth_id: authId,
        email: email,
        username: username,
        first_name: name || null,
        verified: false,
        followers_count: 0,
        following_count: 0,
        posts_count: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .select(
        `
        id,
        auth_id,
        email,
        username,
        first_name,
        last_name,
        bio,
        location,
        website,
        links,
        pronouns,
        gender,
        sexuality,
        event_audience,
        verified,
        followers_count,
        following_count,
        posts_count,
        avatar:avatar_id(url)
      `,
      )
      .single();

    if (createError) {
      console.error("[Edge:auth-sync] Failed to create user:", createError);
      return errorResponse("internal_error", "Failed to create user");
    }

    console.log("[Edge:auth-sync] Created new user:", newUser.id);
    await applyBrandOnboarding(supabaseAdmin, newUser);

    return jsonResponse({
      ok: true,
      data: {
        user: formatUserResponse(newUser),
        action: "created",
      },
    });
  } catch (err) {
    console.error("[Edge:auth-sync] Unexpected error:", err);
    return errorResponse("internal_error", "An unexpected error occurred");
  }
});

function formatUserResponse(data: any) {
  return {
    id: String(data.id),
    authId: data.auth_id,
    email: data.email,
    username: data.username,
    name: data.first_name || data.username,
    firstName: data.first_name,
    lastName: data.last_name,
    bio: data.bio,
    location: data.location,
    website: data.website,
    links: normalizeLinks(data.links),
    pronouns: data.pronouns,
    gender: data.gender,
    sexuality: data.sexuality || [],
    eventAudience: data.event_audience || null,
    avatar: data.avatar?.url || null,
    isVerified: data.verified || false,
    postsCount: data.posts_count || 0,
    followersCount: data.followers_count || 0,
    followingCount: data.following_count || 0,
  };
}
