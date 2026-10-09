/**
 * Authenticated, self-only authoritative onboarding status.
 * Web routes must never trust localStorage or client-provided ids as proof of
 * an uploaded profile image or a published first post. Existing accounts can
 * browse normally; 2026-10-09+ members complete ID/email, photo, then post.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifySession, corsHeaders, optionsResponse } from "../_shared/verify-session.ts";
import { checkAdultBirthDate } from "../_shared/age-policy.ts";
import {
  determineNewMemberStep,
  isNewMemberOnboardingEnabled,
} from "../_shared/new-member-onboarding.ts";
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
  // Gate off: report "not_required" so web and native clients never redirect.
  if (!isNewMemberOnboardingEnabled()) {
    return json(req, { ok: true, data: { step: "not_required", required: false } });
  }

  const [{ data: account, error: accountError }, { data: profile, error: profileError },
         { data: verified, error: verifiedError }] = await Promise.all([
    db.from("user").select("id, createdAt, emailVerified, image").eq("id", authId).maybeSingle(),
    db.from("users").select("id, auth_id, avatar_id").eq("auth_id", authId).maybeSingle(),
    db.from("identity_verifications").select("status, date_of_birth").eq("user_id", authId).maybeSingle(),
  ]);
  if (accountError || profileError || verifiedError || !account || !profile ||
      account.id !== authId || profile.auth_id !== authId) {
    console.error("[new-member-progress] status_unavailable");
    return json(req, { ok: false, error: "Could not load onboarding progress. Retry." }, 503);
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
  const adultVerified = verified?.status === "passed" &&
    checkAdultBirthDate(verified.date_of_birth).allowed;
  const step = determineNewMemberStep({
    accountCreatedAt: account.createdAt,
    emailVerified: account.emailVerified === true,
    adultVerified,
    hasProfilePhoto: hasPhoto,
    hasPost,
  });
  // No DOB, auth tokens, document IDs or email leaves the server.
  return json(req, { ok: true, data: {
    step, required: step !== "not_required",
    hasPhoto, hasPost, emailVerified: account.emailVerified === true, adultVerified,
  } });
}));
