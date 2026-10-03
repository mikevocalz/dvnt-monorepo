/**
 * editorial-admin — the control plane for the AI editorial lanes.
 *
 * Admin-only, gated on DVNT_ADMIN_AUTH_IDS. Four actions:
 *   GET                  read every lane and the recent job log
 *   POST profile         patch one lane's configuration
 *   POST enqueue         create a content or engagement job
 *   POST approve|reject|pause|unpause
 *
 * Two rules here are load-bearing, and both were broken:
 *
 *   account_auth_id is the identity every published job posts under
 *   (process-editorial-jobs reads profile.account_auth_id). It used to ride an
 *   allow-list straight into the UPDATE with no validation, so pointing it at
 *   a member's Better Auth id made AI output publish as that member. It is now
 *   checked against users.is_editorial before the write, and a BEFORE trigger
 *   on editorial_profiles rejects the same binding at the table.
 *
 *   The handler body throws. `await req.json().catch(() => ({}))` can return
 *   a body with no `patch`, and `if (k in body.patch)` on it threw a TypeError
 *   straight out of Deno.serve as a raw stack. Every path now runs inside one
 *   try/catch that logs the detail and answers with a generic 500.
 *
 * The pure validation rules live in ../_shared/editorial-safety.ts, where the
 * deno-shared-suites CI job executes them.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  corsHeaders,
  optionsResponse,
  verifySession,
} from "../_shared/verify-session.ts";
import {
  boundAccountAuthId,
  isEngagementAction,
  isVerifiedAdultRow,
  readProfilePatch,
  sourcePolicySatisfied,
} from "../_shared/editorial-safety.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

/** Postgres check_violation. Our triggers and CHECK constraints raise it. */
const CHECK_VIOLATION = "23514";

function json(req: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), "Content-Type": "application/json" },
  });
}

function adminIds() {
  return new Set(
    (Deno.env.get("DVNT_ADMIN_AUTH_IDS") || "")
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean),
  );
}

// deno-lint-ignore no-explicit-any
type Db = any;

/** Positive 18+ identity evidence for an engagement target. */
async function verifiedAdultTarget(db: Db, userId: string) {
  const { data } = await db
    .from("identity_verifications")
    .select("status,date_of_birth")
    .eq("user_id", userId)
    .maybeSingle();
  return isVerifiedAdultRow(data);
}

/**
 * Is this Better Auth id one of DVNT's designated editorial accounts?
 *
 * Modelled on verifyBrandSender in ../_shared/brand-sender.ts, which proves a
 * configured identity against the row before anything sends as it. The marker
 * is users.is_editorial, written by migration only — no API path sets it — so
 * a caller cannot nominate an account and then bind to it.
 */
async function isEditorialAccount(db: Db, authId: string) {
  const { data, error } = await db
    .from("users")
    .select("auth_id,is_editorial")
    .eq("auth_id", authId)
    .maybeSingle();
  if (error || !data) return false;
  return data.is_editorial === true;
}

async function handleProfilePatch(req: Request, db: Db, body: Db) {
  const read = readProfilePatch(body);
  if (!read.ok) return json(req, { ok: false, error: read.error }, 400);

  const slug = String(body.slug || "").trim();
  if (!slug) return json(req, { ok: false, error: "A profile slug is required" }, 400);

  const bound = boundAccountAuthId(read.patch);
  if (bound !== null) {
    if (!bound) {
      return json(req, { ok: false, error: "account_auth_id cannot be blank" }, 400);
    }
    if (!(await isEditorialAccount(db, bound))) {
      return json(req, {
        ok: false,
        error:
          "account_auth_id must name a designated DVNT editorial account. A member account cannot be bound to an AI lane.",
      }, 400);
    }
    read.patch.account_auth_id = bound;
  }

  const { data, error } = await db
    .from("editorial_profiles")
    .update({ ...read.patch, updated_at: new Date().toISOString() })
    .eq("slug", slug)
    .select("*")
    .single();
  if (error) {
    // editorial_profiles_visual_requires_approval is the one a well-formed
    // patch hits: it refuses requires_human_approval = false on any lane that
    // can post an image or a video.
    const message = String(error.code) === CHECK_VIOLATION
      ? "An image or video lane cannot switch off requires_human_approval"
      : error.message;
    return json(req, { ok: false, error: message }, 400);
  }
  return json(req, { ok: true, data });
}

async function handleEnqueue(req: Request, db: Db, body: Db, actor: string) {
  const { data: profile } = await db
    .from("editorial_profiles")
    .select("*")
    .eq("slug", String(body.profile_slug || ""))
    .maybeSingle();
  if (!profile) {
    return json(req, { ok: false, error: "Editorial profile not found" }, 404);
  }
  // Re-proved here, not only at bind time: the marker can be revoked after a
  // lane is bound, and a job queued then would publish as a demoted account.
  if (
    !profile.account_auth_id ||
    !(await isEditorialAccount(db, String(profile.account_auth_id)))
  ) {
    return json(req, {
      ok: false,
      error: "Bind the profile to a real DVNT editorial account before scheduling",
    }, 409);
  }

  const sources = Array.isArray(body.sources) ? body.sources : [];
  if (!sourcePolicySatisfied(profile, sources)) {
    return json(req, {
      ok: false,
      error: "This editorial lane requires source provenance",
    }, 400);
  }

  const jobType = body.job_type === "engagement" ? "engagement" : "content";
  const engagementAction = jobType === "engagement"
    ? String(body.engagement_action || "")
    : null;
  const targetUserId = jobType === "engagement"
    ? String(body.target_user_id || "")
    : null;
  const targetPostId = jobType === "engagement" && body.target_post_id != null
    ? Number(body.target_post_id)
    : null;

  if (jobType === "engagement") {
    if (!isEngagementAction(engagementAction) || !targetUserId) {
      return json(req, {
        ok: false,
        error: "Engagement jobs require a valid action and target_user_id",
      }, 400);
    }
    // Editorial automation never engages an account until DVNT has positive
    // 18+ identity evidence. This is intentionally stricter than the general
    // rollout cohort so a service-role bot cannot reach a minor through a
    // path the client gate would otherwise hide.
    if (!(await verifiedAdultTarget(db, targetUserId))) {
      await db.from("editorial_engagement_audit").insert({
        profile_id: profile.id,
        action: engagementAction,
        target_user_id: targetUserId,
        target_post_id: Number.isFinite(targetPostId) ? targetPostId : null,
        reason: "Target is not a verified adult",
        status: "blocked",
      });
      return json(req, {
        ok: false,
        error: "Editorial engagement target is not verified 18+",
      }, 403);
    }
  }

  const key = String(body.idempotency_key || crypto.randomUUID());
  const row = {
    profile_id: profile.id,
    idempotency_key: key,
    job_type: jobType,
    engagement_action: engagementAction,
    target_user_id: targetUserId,
    target_post_id: Number.isFinite(targetPostId) ? targetPostId : null,
    stage: "intake",
    idea: String(body.idea || "").trim().slice(0, 5000),
    source_snapshot: sources,
    scheduled_for: body.scheduled_for || null,
    prompt_version: profile.prompt_version,
    created_by: actor,
  };

  const { data, error } = await db
    .from("editorial_jobs")
    .insert(row)
    .select("*")
    .single();
  if (error && String(error.code) === "23505") {
    const { data: existing } = await db
      .from("editorial_jobs")
      .select("*")
      .eq("idempotency_key", key)
      .single();
    return json(req, { ok: true, replayed: true, data: existing });
  }
  if (error) return json(req, { ok: false, error: error.message }, 400);

  await db.from("editorial_job_events").insert({
    job_id: data.id,
    stage: "intake",
    actor_type: "editor",
    actor_id: actor,
  });
  return json(req, { ok: true, data });
}

async function handleReview(req: Request, db: Db, body: Db, actor: string) {
  if (body.action === "pause" || body.action === "unpause") {
    const { error } = await db
      .from("editorial_profiles")
      .update({
        paused: body.action === "pause",
        updated_at: new Date().toISOString(),
      })
      .eq("slug", String(body.profile_slug || ""));
    return error
      ? json(req, { ok: false, error: error.message }, 400)
      : json(req, { ok: true });
  }

  const stage = body.action === "approve" ? "approved" : "rejected";
  // deno-lint-ignore no-explicit-any
  const patch: Record<string, any> = {
    stage,
    updated_at: new Date().toISOString(),
  };
  if (stage === "approved") patch.approved_by = actor;

  const from = stage === "approved"
    ? ["moderated", "awaiting_approval"]
    : ["intake", "validated", "generated", "moderated", "awaiting_approval"];

  const { data, error } = await db
    .from("editorial_jobs")
    .update(patch)
    .eq("id", body.job_id)
    .in("stage", from)
    .select("*")
    .maybeSingle();
  if (error || !data) {
    return json(req, {
      ok: false,
      error: error?.message || "Job is not in an approvable state",
    }, 409);
  }

  await db.from("editorial_job_events").insert({
    job_id: data.id,
    stage,
    actor_type: "editor",
    actor_id: actor,
    detail: { reason: body.reason || null },
  });
  return json(req, { ok: true, data });
}

async function handle(req: Request): Promise<Response> {
  const db = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const actor = await verifySession(db, req);
  if (!actor) return json(req, { ok: false, error: "Unauthorized" }, 401);
  if (!adminIds().has(String(actor))) {
    return json(req, { ok: false, error: "Forbidden" }, 403);
  }

  if (req.method === "GET") {
    const url = new URL(req.url);
    const { data: profiles } = await db
      .from("editorial_profiles")
      .select("*")
      .order("display_name");
    const { data: jobs } = await db
      .from("editorial_jobs")
      .select("*, profile:editorial_profiles(slug,display_name,disclosure_label)")
      .order("created_at", { ascending: false })
      .limit(Number(url.searchParams.get("limit") || 100));
    return json(req, { ok: true, profiles: profiles || [], jobs: jobs || [] });
  }

  if (req.method !== "POST") {
    return json(req, { ok: false, error: "Method not allowed" }, 405);
  }

  const body = await req.json().catch(() => ({}));
  if (!body || typeof body !== "object") {
    return json(req, { ok: false, error: "A JSON object body is required" }, 400);
  }

  if (body.action === "profile") return handleProfilePatch(req, db, body);
  if (body.action === "enqueue") return handleEnqueue(req, db, body, String(actor));
  if (["approve", "reject", "pause", "unpause"].includes(body.action)) {
    return handleReview(req, db, body, String(actor));
  }
  return json(req, { ok: false, error: "Unknown action" }, 400);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return optionsResponse();
  try {
    return await handle(req);
  } catch (e) {
    // The detail goes to the log, never to the caller. The unguarded version
    // of this handler returned a raw stack trace for a body with no `patch`.
    console.error("[editorial-admin] unhandled error", e);
    return json(req, { ok: false, error: "Internal error" }, 500);
  }
});
