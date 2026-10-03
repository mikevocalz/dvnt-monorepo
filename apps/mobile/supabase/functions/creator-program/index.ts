/**
 * Creator Lynk program — enrollment, terms, scheduling, cancellation, incidents.
 *
 * Six actions behind one thin dispatcher. Each handler gets the same context
 * and owns its own refusals; the dispatcher owns auth, verified admission, and
 * loading the caller's `creator_hosts` row for the actions that need one.
 *
 * Two rules the previous single-function shape broke:
 *
 *   • The client never names a `status`. `creator_hosts.status` legally holds
 *     'suspended' and 'rejected', so an upsert of `status: 'applied'` let a
 *     suspended creator clear their own suspension while `suspended_at` and
 *     `suspension_reason` stayed populated.
 *   • A swallowed query error is not an empty result. A failed dashboard read
 *     used to render an empty earnings dashboard with `ok: true`, and a failed
 *     creator lookup produced a spurious "Creator enrollment required" 403.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifySession, corsHeaders, optionsResponse } from "../_shared/verify-session.ts";
import { resolveVerifiedAdmission, admissionRefusal } from "../_shared/verified-admission.ts";
import {
  creatorStandingRefusal,
  decideCreatorStanding,
} from "../_shared/creator-standing.ts";
import { parseCreatorSessionInput } from "../_shared/creator-session-input.ts";
import {
  applyForCreatorProgram,
  CREATOR_COLUMNS,
  type CreatorRecord,
} from "../_shared/creator-apply.ts";
import { eventRelationships } from "../_shared/event-access.ts";
import { withSentry } from "../_shared/sentry.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const CURRENT_TERMS_VERSION = "creator-host-v1";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function json(body: unknown, status = 200, req?: Request) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...(req ? corsHeaders(req) : {}),
      "Content-Type": "application/json",
    },
  });
}

type CreatorRow = CreatorRecord;

interface Ctx {
  db: any;
  req: Request;
  authId: string;
  body: Record<string, unknown>;
  /** Null for `apply` and for a `dashboard` call from an unenrolled account. */
  creator: CreatorRow | null;
}

/** `session_id` reaches Postgres as a uuid; junk must be a 400, not a 22P02 500. */
function sessionId(body: Record<string, unknown>): string | null {
  const value = typeof body.session_id === "string" ? body.session_id.trim() : "";
  return UUID.test(value) ? value : null;
}

function readCreator(db: any, authId: string) {
  return db.from("creator_hosts").select(CREATOR_COLUMNS).eq("user_id", authId)
    .maybeSingle();
}

// ── apply ───────────────────────────────────────────────────────────────────
async function handleApply({ db, req, authId }: Ctx) {
  // The request body is never read here. See _shared/creator-apply.ts: a new
  // row gets the column DEFAULT, an existing row is refused with 409 and left
  // as it was, so a suspended or rejected creator cannot reset their status.
  const outcome = await applyForCreatorProgram(db, authId);
  switch (outcome.kind) {
    case "created":
      return json({ ok: true, creator: outcome.creator, created: true }, 200, req);
    case "accepted":
      return json({ ok: true, creator: outcome.creator, created: false, accepted: true }, 200, req);
    case "exists":
      return json(
        { ok: false, error: outcome.message, code: outcome.code, creator: outcome.creator },
        409,
        req,
      );
    case "failed":
      return json({ ok: false, error: outcome.message }, 500, req);
  }
}

// ── dashboard ───────────────────────────────────────────────────────────────
async function handleDashboard({ db, req, authId, creator }: Ctx) {
  const [sessions, ledger] = await Promise.all([
    db.from("creator_lynk_sessions")
      .select("id,event_id,title,starts_at,ends_at,capacity,status,compensation_snapshot,referral_code")
      .eq("creator_user_id", authId)
      .order("starts_at", { ascending: false })
      .limit(100),
    db.from("creator_earnings_ledger")
      .select("id,session_id,kind,amount_cents,currency,status,reason,paid_at,payout_batch_key,created_at")
      .eq("creator_user_id", authId)
      .order("created_at", { ascending: false })
      .limit(200),
  ]);
  // A money surface that renders zero because the query failed is worse than
  // an error: the creator reads it as "I earned nothing".
  for (const [label, result] of [["sessions", sessions], ["ledger", ledger]] as const) {
    if (result.error) {
      console.error(`[creator-program] dashboard ${label} failed`, result.error.message);
      return json({ ok: false, error: "Could not load your creator dashboard" }, 500, req);
    }
  }
  return json({
    ok: true,
    creator,
    sessions: sessions.data ?? [],
    ledger: ledger.data ?? [],
  }, 200, req);
}

// ── accept_terms ────────────────────────────────────────────────────────────
async function handleAcceptTerms({ db, req, authId }: Ctx) {
  const now = new Date().toISOString();
  const { error } = await db.from("creator_hosts").update({
    terms_version: CURRENT_TERMS_VERSION,
    terms_accepted_at: now,
    updated_at: now,
  }).eq("user_id", authId);
  if (error) {
    console.error("[creator-program] accept_terms failed", error.message);
    return json({ ok: false, error: "Could not accept creator terms" }, 500, req);
  }
  return json({ ok: true, termsVersion: CURRENT_TERMS_VERSION }, 200, req);
}

// ── schedule ────────────────────────────────────────────────────────────────
async function handleSchedule({ db, req, authId, body, creator }: Ctx) {
  // Standing speaks first so a suspended creator hears why, rather than the
  // generic "only approved creators" line. `approved` is then still required:
  // standing refuses suspended/rejected/paused, approval is the positive grant.
  const standing = decideCreatorStanding({ userId: authId, record: creator });
  if (standing.state === "refused") {
    const refusal = creatorStandingRefusal(standing);
    return json(
      { ok: false, error: refusal.message, code: refusal.code, reason: refusal.reason },
      403,
      req,
    );
  }
  if (creator!.status !== "approved") {
    return json({ ok: false, error: "Only approved creators can schedule sessions" }, 403, req);
  }
  if (creator!.terms_version !== CURRENT_TERMS_VERSION || !creator!.terms_accepted_at) {
    return json({ ok: false, error: "Accept the current creator host terms first" }, 409, req);
  }

  const parsed = parseCreatorSessionInput(body);
  if (!parsed.ok) return json({ ok: false, error: parsed.error }, 400, req);
  const input = parsed.value;

  // `event_id` carries compensation_snapshot and referral_code onto the row,
  // which is the revenue-share attribution path. Attaching a session to an
  // event the caller does not organize would hand them someone else's
  // attribution, so the link needs the same ownership proof every other
  // event write uses.
  if (input.eventId !== null) {
    const { data: event, error } = await db.from("events")
      .select("id, host_id, status").eq("id", input.eventId).maybeSingle();
    if (error) {
      console.error("[creator-program] event lookup failed", error.message);
      return json({ ok: false, error: "Could not verify the event" }, 500, req);
    }
    if (!event || ["cancelled", "deleted"].includes(event.status ?? "")) {
      return json({ ok: false, error: "Event not found" }, 404, req);
    }
    let organizer = false;
    try {
      organizer = (await eventRelationships(db, event, authId)).organizer;
    } catch (err) {
      console.error("[creator-program] event access failed", err);
      return json({ ok: false, error: "Could not verify the event" }, 500, req);
    }
    if (!organizer) {
      return json({ ok: false, error: "You do not organize that event" }, 403, req);
    }
  }

  const { data: plan, error: planError } = await db
    .from("creator_compensation_plans")
    .select("id,name,version,flat_fee_cents,revenue_share_bps,attendance_bonus_cents,attendance_bonus_threshold")
    .eq("active", true)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (planError) {
    console.error("[creator-program] plan lookup failed", planError.message);
    return json({ ok: false, error: "Could not read the creator compensation plan" }, 500, req);
  }
  if (!plan) return json({ ok: false, error: "No active creator compensation plan" }, 409, req);

  const snapshot = {
    id: plan.id,
    name: plan.name,
    version: plan.version,
    flatFeeCents: plan.flat_fee_cents,
    revenueShareBps: plan.revenue_share_bps,
    attendanceBonusCents: plan.attendance_bonus_cents,
    attendanceBonusThreshold: plan.attendance_bonus_threshold,
  };
  const referralCode = crypto.randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase();

  const { data: session, error } = await db.from("creator_lynk_sessions").insert({
    creator_user_id: authId,
    event_id: input.eventId,
    title: input.title,
    starts_at: input.startsAtIso,
    ends_at: input.endsAtIso,
    capacity: input.capacity,
    status: "scheduled",
    compensation_plan_id: plan.id,
    compensation_snapshot: snapshot,
    referral_code: referralCode,
  }).select("*").single();
  if (error) {
    console.error("[creator-program] schedule failed", error.message);
    return json({ ok: false, error: "Could not schedule creator session" }, 500, req);
  }
  return json({ ok: true, session }, 200, req);
}

// ── cancel ──────────────────────────────────────────────────────────────────
async function handleCancel({ db, req, authId, body }: Ctx) {
  const id = sessionId(body);
  if (!id) return json({ ok: false, error: "session_id required" }, 400, req);

  // One statement decides. The old shape read the row, checked the status in
  // JS, then issued an UPDATE keyed only on the id and discarded its result:
  // a concurrent `live` transition and an outright failed write both returned
  // ok:true. Re-stating creator_user_id and status in the UPDATE makes the
  // guard atomic, and the returned rows say whether it landed.
  const { data, error } = await db.from("creator_lynk_sessions")
    .update({ status: "cancelled", updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("creator_user_id", authId)
    .eq("status", "scheduled")
    .select("id,status");
  if (error) {
    console.error("[creator-program] cancel failed", error.message);
    return json({ ok: false, error: "Could not cancel the session" }, 500, req);
  }
  if (data?.length) return json({ ok: true, session: data[0] }, 200, req);

  // Nothing matched. Separate "not yours / gone" from "no longer scheduled"
  // without reading another creator's rows.
  const own = await db.from("creator_lynk_sessions").select("status")
    .eq("id", id).eq("creator_user_id", authId).maybeSingle();
  if (own.error) {
    console.error("[creator-program] cancel re-read failed", own.error.message);
    return json({ ok: false, error: "Could not cancel the session" }, 500, req);
  }
  if (!own.data) return json({ ok: false, error: "Session not found" }, 404, req);
  return json({ ok: false, error: "Only scheduled sessions can be cancelled" }, 409, req);
}

// ── incident ────────────────────────────────────────────────────────────────
async function handleIncident({ db, req, authId, body }: Ctx) {
  const id = sessionId(body);
  const kind = String(body.kind || "").trim().slice(0, 80);
  if (!id || !kind) return json({ ok: false, error: "session_id and kind required" }, 400, req);

  const owned = await db.from("creator_lynk_sessions").select("id")
    .eq("id", id).eq("creator_user_id", authId).maybeSingle();
  if (owned.error) {
    console.error("[creator-program] incident lookup failed", owned.error.message);
    return json({ ok: false, error: "Could not record incident" }, 500, req);
  }
  if (!owned.data) return json({ ok: false, error: "Session not found" }, 404, req);

  const { error } = await db.from("creator_incidents").insert({
    creator_user_id: authId,
    session_id: id,
    reported_user_id: typeof body.reported_user_id === "string" ? body.reported_user_id : null,
    kind,
    notes: typeof body.notes === "string" ? body.notes.slice(0, 2000) : null,
  });
  if (error) {
    console.error("[creator-program] incident failed", error.message);
    return json({ ok: false, error: "Could not record incident" }, 500, req);
  }
  return json({ ok: true }, 200, req);
}

/**
 * `enrollment` is what the dispatcher does with the caller's creator_hosts row:
 *   none     — never read it (apply creates it)
 *   optional — read it, pass it through, null is fine (dashboard)
 *   required — read it, refuse with 403 when there is no row
 */
const ACTIONS: Record<
  string,
  { enrollment: "none" | "optional" | "required"; run: (ctx: Ctx) => Promise<Response> }
> = {
  apply: { enrollment: "none", run: handleApply },
  dashboard: { enrollment: "optional", run: handleDashboard },
  accept_terms: { enrollment: "required", run: handleAcceptTerms },
  schedule: { enrollment: "required", run: handleSchedule },
  cancel: { enrollment: "required", run: handleCancel },
  incident: { enrollment: "required", run: handleIncident },
};

Deno.serve(withSentry("creator-program", async (req: Request) => {
  if (req.method === "OPTIONS") return optionsResponse();
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405, req);

  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const authId = await verifySession(db, req);
  if (!authId) return json({ ok: false, error: "Unauthorized" }, 401, req);

  const admission = await resolveVerifiedAdmission(db, authId);
  if (admission.state === "blocked") {
    const refusal = admissionRefusal(admission);
    return json({ ok: false, error: refusal.message, code: refusal.code, reason: refusal.reason }, 403, req);
  }

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const route = ACTIONS[String(body.action || "")];
  if (!route) return json({ ok: false, error: "Unknown action" }, 400, req);

  let creator: CreatorRow | null = null;
  if (route.enrollment !== "none") {
    const { data, error } = await readCreator(db, authId);
    // A transient read failure is a 500. Reporting it as "enrollment
    // required" told an approved creator they were not in the program.
    if (error) {
      console.error("[creator-program] creator lookup failed", error.message);
      return json({ ok: false, error: "Could not load your creator profile" }, 500, req);
    }
    creator = data ?? null;
    if (!creator && route.enrollment === "required") {
      return json({ ok: false, error: "Creator enrollment required" }, 403, req);
    }
  }

  return await route.run({ db, req, authId, body, creator });
}));
