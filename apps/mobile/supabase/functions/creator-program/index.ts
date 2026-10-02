import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifySession, corsHeaders, optionsResponse } from "../_shared/verify-session.ts";
import { resolveVerifiedAdmission, admissionRefusal } from "../_shared/verified-admission.ts";
import { withSentry } from "../_shared/sentry.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const CURRENT_TERMS_VERSION = "creator-host-v1";

function json(body: unknown, status = 200, req?: Request) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...(req ? corsHeaders(req) : {}),
      "Content-Type": "application/json",
    },
  });
}

function cleanTitle(value: unknown) {
  const title = typeof value === "string" ? value.trim() : "";
  return title.slice(0, 120);
}

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
  const action = String(body.action || "");

  if (action === "apply") {
    const { data, error } = await db.from("creator_hosts").upsert(
      {
        user_id: authId,
        status: "applied",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    ).select("user_id,status,payout_status,terms_version,terms_accepted_at").single();
    if (error) return json({ ok: false, error: "Could not submit creator application" }, 500, req);
    return json({ ok: true, creator: data }, 200, req);
  }

  const { data: creator } = await db
    .from("creator_hosts")
    .select("user_id,status,payout_status,terms_version,terms_accepted_at")
    .eq("user_id", authId)
    .maybeSingle();

  if (action === "dashboard") {
    const [{ data: sessions }, { data: ledger }] = await Promise.all([
      db.from("creator_lynk_sessions")
        .select("id,event_id,title,starts_at,ends_at,capacity,status,compensation_snapshot,referral_code")
        .eq("creator_user_id", authId)
        .order("starts_at", { ascending: false })
        .limit(100),
      db.from("creator_earnings_ledger")
        .select("id,session_id,kind,amount_cents,currency,status,reason,created_at")
        .eq("creator_user_id", authId)
        .order("created_at", { ascending: false })
        .limit(200),
    ]);
    return json({ ok: true, creator: creator ?? null, sessions: sessions ?? [], ledger: ledger ?? [] }, 200, req);
  }

  if (!creator) return json({ ok: false, error: "Creator enrollment required" }, 403, req);

  if (action === "accept_terms") {
    const { error } = await db.from("creator_hosts").update({
      terms_version: CURRENT_TERMS_VERSION,
      terms_accepted_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("user_id", authId);
    if (error) return json({ ok: false, error: "Could not accept creator terms" }, 500, req);
    return json({ ok: true, termsVersion: CURRENT_TERMS_VERSION }, 200, req);
  }

  if (action === "schedule") {
    if (creator.status !== "approved") {
      return json({ ok: false, error: "Only approved creators can schedule sessions" }, 403, req);
    }
    if (creator.terms_version !== CURRENT_TERMS_VERSION || !creator.terms_accepted_at) {
      return json({ ok: false, error: "Accept the current creator host terms first" }, 409, req);
    }
    const title = cleanTitle(body.title);
    const startsAt = typeof body.starts_at === "string" ? Date.parse(body.starts_at) : NaN;
    const endsAt = typeof body.ends_at === "string" ? Date.parse(body.ends_at) : NaN;
    const capacity = body.capacity == null ? null : Number(body.capacity);
    if (!title || !Number.isFinite(startsAt) || startsAt <= Date.now()) {
      return json({ ok: false, error: "A future starts_at and title are required" }, 400, req);
    }
    if (Number.isFinite(endsAt) && endsAt <= startsAt) {
      return json({ ok: false, error: "ends_at must be after starts_at" }, 400, req);
    }
    if (capacity !== null && (!Number.isInteger(capacity) || capacity <= 0 || capacity > 5000)) {
      return json({ ok: false, error: "capacity must be 1-5000" }, 400, req);
    }

    const { data: plan } = await db
      .from("creator_compensation_plans")
      .select("id,name,version,flat_fee_cents,revenue_share_bps,attendance_bonus_cents,attendance_bonus_threshold")
      .eq("active", true)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
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
      event_id: Number.isInteger(Number(body.event_id)) ? Number(body.event_id) : null,
      title,
      starts_at: new Date(startsAt).toISOString(),
      ends_at: Number.isFinite(endsAt) ? new Date(endsAt).toISOString() : null,
      capacity,
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

  if (action === "cancel") {
    const sessionId = String(body.session_id || "");
    if (!sessionId) return json({ ok: false, error: "session_id required" }, 400, req);
    const { data: session } = await db.from("creator_lynk_sessions")
      .select("id,status,starts_at")
      .eq("id", sessionId)
      .eq("creator_user_id", authId)
      .maybeSingle();
    if (!session) return json({ ok: false, error: "Session not found" }, 404, req);
    if (session.status !== "scheduled") return json({ ok: false, error: "Only scheduled sessions can be cancelled" }, 409, req);
    await db.from("creator_lynk_sessions").update({ status: "cancelled", updated_at: new Date().toISOString() }).eq("id", sessionId);
    return json({ ok: true }, 200, req);
  }

  if (action === "incident") {
    const sessionId = String(body.session_id || "");
    const kind = String(body.kind || "").trim().slice(0, 80);
    if (!sessionId || !kind) return json({ ok: false, error: "session_id and kind required" }, 400, req);
    const { data: owned } = await db.from("creator_lynk_sessions").select("id")
      .eq("id", sessionId).eq("creator_user_id", authId).maybeSingle();
    if (!owned) return json({ ok: false, error: "Session not found" }, 404, req);
    const { error } = await db.from("creator_incidents").insert({
      creator_user_id: authId,
      session_id: sessionId,
      reported_user_id: typeof body.reported_user_id === "string" ? body.reported_user_id : null,
      kind,
      notes: typeof body.notes === "string" ? body.notes.slice(0, 2000) : null,
    });
    if (error) return json({ ok: false, error: "Could not record incident" }, 500, req);
    return json({ ok: true }, 200, req);
  }

  return json({ ok: false, error: "Unknown action" }, 400, req);
}));
