/**
 * Authenticated, self-only authoritative profile-entry status.
 *
 * Every DVNT member must have a saved profile photo and at least one published
 * post. The server derives both facts from canonical records on every check so
 * local storage, stale counters, reinstalls, or account age cannot bypass it.
 *
 * Email/adult verification is still returned as informational state because
 * other DVNT rails enforce it independently; it does not exempt anyone from the
 * photo + first-post requirement.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifySession, corsHeaders, optionsResponse } from "../_shared/verify-session.ts";
import { checkAdultBirthDate } from "../_shared/age-policy.ts";
import { determineNewMemberStep } from "../_shared/new-member-onboarding.ts";
import { withSentry } from "../_shared/sentry.ts";

function json(req: Request, value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { ...corsHeaders(req), "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

Deno.serve(withSentry("new-member-progress", async (req) => {
  if (req.method === "OPTIONS") return optionsResponse(req);
  if (req.method !== "POST") return json(req, { ok: false, error: "POST only" }, 405);

  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return json(req, { ok: false, error: "Temporarily unavailable" }, 503);

  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const authId = await verifySession(db, req);
  if (!authId) return json(req, { ok: false, error: "Please sign in again" }, 401);

  const [
    { data: account, error: accountError },
    { data: profile, error: profileError },
    { data: verified, error: verifiedError },
  ] = await Promise.all([
    db.from("user").select("id, createdAt, emailVerified, image").eq("id", authId).maybeSingle(),
    db.from("users").select("id, auth_id, avatar_id").eq("auth_id", authId).maybeSingle(),
    db
      .from("identity_verifications")
      .select("status, date_of_birth, updated_at")
      .eq("user_id", authId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (accountError || profileError || !account || !profile ||
      account.id !== authId || profile.auth_id !== authId) {
    console.error("[new-member-progress] status_unavailable");
    return json(req, { ok: false, error: "Could not load profile progress. Retry." }, 503);
  }

  const [{ data: media, error: mediaError }, { data: posts, error: postError }] = await Promise.all([
    profile.avatar_id == null
      ? Promise.resolve({ data: null, error: null })
      : db.from("media").select("id, url").eq("id", profile.avatar_id).maybeSingle(),
    db.from("posts").select("id").eq("author_id", profile.id).limit(1),
  ]);

  if (mediaError || postError) {
    console.error("[new-member-progress] evidence_unavailable");
    return json(req, { ok: false, error: "Could not confirm profile progress. Retry." }, 503);
  }

  const hasPhoto = Boolean(String(media?.url ?? account.image ?? "").trim());
  const hasPost = Array.isArray(posts) && posts.length > 0;
  const adultVerified = !verifiedError &&
    verified?.status === "passed" &&
    checkAdultBirthDate(verified.date_of_birth).allowed;

  if (verifiedError) {
    // Verification state is a separate rail. Do not let a failed informational
    // read turn into a bypass or block for the mandatory photo/post check.
    console.warn("[new-member-progress] verification_state_unavailable");
  }

  const step = determineNewMemberStep({
    accountCreatedAt: account.createdAt,
    emailVerified: account.emailVerified === true,
    adultVerified,
    hasProfilePhoto: hasPhoto,
    hasPost,
  });

  // No DOB, auth tokens, document IDs or email leaves the server.
  return json(req, {
    ok: true,
    data: {
      step,
      required: step !== "complete",
      hasPhoto,
      hasPost,
      emailVerified: account.emailVerified === true,
      adultVerified,
    },
  });
}));
