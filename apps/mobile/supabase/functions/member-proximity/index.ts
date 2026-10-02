/**
 * member-proximity
 *
 * Consent-based member proximity without exposing another member's coordinates.
 *
 * POST { action: "publish", latitude, longitude, cityId?, accuracyMeters?, shareUntil }
 * POST { action: "revoke" }
 * POST { action: "distance", targetUsername, viewerLatitude?, viewerLongitude? }
 *
 * Publishing requires an approved adult identity verification. Distance reads
 * are session-authenticated, blocked/private-aware, rate-limited, and return
 * only a rounded distance or a city-only fallback.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifySessionDetailed } from "../_shared/verify-session.ts";
import { resolveOrProvisionUser } from "../_shared/resolve-user.ts";
import { resolveVerifiedAdmission } from "../_shared/verified-admission.ts";
import { checkRateLimit } from "../_shared/rate-limit.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-auth-token, x-client-info, apikey, content-type, sentry-trace, baggage",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function finiteCoord(value: unknown, min: number, max: number): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
}

function quantize(value: number): number {
  // ~110m latitude resolution. Enough for honest nearby distance without
  // persisting GPS-grade precision.
  return Math.round(value * 1000) / 1000;
}

function haversineMiles(lat1: number, lng1: number, lat2: number, lng2: number) {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) ** 2;
  return 3958.7613 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function roundedMiles(miles: number) {
  if (miles < 0.25) return 0.2;
  if (miles < 10) return Math.round(miles * 10) / 10;
  return Math.round(miles);
}

async function hasAdultVerification(db: any, userId: string) {
  const { data, error } = await db
    .from("identity_verifications")
    .select("status, date_of_birth")
    .eq("user_id", userId)
    .maybeSingle();
  if (error || data?.status !== "passed" || !data?.date_of_birth) return false;
  const dob = new Date(`${data.date_of_birth}T00:00:00Z`);
  if (!Number.isFinite(dob.getTime())) return false;
  const cutoff = new Date();
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - 18);
  return dob.getTime() <= cutoff.getTime();
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return json({ ok: false, error: "Server configuration error" }, 500);
  }

  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const session = await verifySessionDetailed(db, req);
  if (!session.ok) {
    return json({ ok: false, error: "Unauthorized" }, 401);
  }
  const authUserId = session.userId;

  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  const action = typeof body?.action === "string" ? body.action : "";
  if (!action) return json({ ok: false, error: "Missing action" }, 400);

  const admission = await resolveVerifiedAdmission(db, authUserId);
  if (admission.state === "blocked") {
    return json(
      { ok: false, error: admission.message || "Adult verification is required", code: admission.reason },
      403,
    );
  }

  if (action === "revoke") {
    await db.from("member_proximity_presence").delete().eq("user_id", authUserId);
    return json({ ok: true, data: { revoked: true } });
  }

  if (action === "publish") {
    const adult = await hasAdultVerification(db, authUserId);
    if (!adult) {
      return json(
        { ok: false, error: "Verify that you are 18+ before sharing member proximity.", code: "adult_verification_required" },
        403,
      );
    }

    const latitude = finiteCoord(body?.latitude, -90, 90);
    const longitude = finiteCoord(body?.longitude, -180, 180);
    const shareUntil = typeof body?.shareUntil === "string" ? Date.parse(body.shareUntil) : NaN;
    const now = Date.now();
    const maxUntil = now + 7 * 24 * 60 * 60 * 1000;
    if (
      latitude === null ||
      longitude === null ||
      !Number.isFinite(shareUntil) ||
      shareUntil <= now ||
      shareUntil > maxUntil + 60_000
    ) {
      return json({ ok: false, error: "Invalid or expired proximity grant" }, 400);
    }

    const cityId = Number(body?.cityId);
    const accuracyMeters = Number(body?.accuracyMeters);
    const { error } = await db.from("member_proximity_presence").upsert(
      {
        user_id: authUserId,
        city_id: Number.isSafeInteger(cityId) && cityId > 0 ? cityId : null,
        latitude: quantize(latitude),
        longitude: quantize(longitude),
        accuracy_meters:
          Number.isFinite(accuracyMeters) && accuracyMeters >= 0
            ? Math.min(accuracyMeters, 50_000)
            : null,
        share_until: new Date(shareUntil).toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );
    if (error) {
      console.error("[member-proximity] publish failed:", error.message);
      return json({ ok: false, error: "Could not update proximity sharing" }, 500);
    }
    return json({ ok: true, data: { sharedUntil: new Date(shareUntil).toISOString() } });
  }

  if (action !== "distance") {
    return json({ ok: false, error: "Unknown action" }, 400);
  }

  const rate = checkRateLimit(authUserId, "member-proximity-distance", {
    maxRequests: 120,
    windowMs: 10 * 60_000,
  });
  if (!rate.allowed) {
    return json({ ok: false, error: "Too many proximity lookups" }, 429);
  }

  const targetUsername =
    typeof body?.targetUsername === "string" ? body.targetUsername.trim() : "";
  if (!targetUsername) return json({ ok: false, error: "targetUsername is required" }, 400);

  const viewer = await resolveOrProvisionUser(db, authUserId, "id, auth_id, username");
  if (!viewer) return json({ ok: false, error: "Viewer not found" }, 404);

  const { data: target, error: targetError } = await db
    .from("users")
    .select("id, auth_id, username, location, is_private")
    .eq("username", targetUsername)
    .maybeSingle();
  if (targetError || !target) {
    return json({ ok: false, error: "Member not found" }, 404);
  }

  if (Number(target.id) === Number(viewer.id)) {
    return json({ ok: true, data: { kind: "self", label: null } });
  }

  const [blockedForward, blockedReverse] = await Promise.all([
    db.from("blocks").select("id").eq("blocker_id", viewer.id).eq("blocked_id", target.id).maybeSingle(),
    db.from("blocks").select("id").eq("blocker_id", target.id).eq("blocked_id", viewer.id).maybeSingle(),
  ]);
  if (blockedForward.data || blockedReverse.data) {
    return json({ ok: true, data: { kind: "unavailable", label: null } });
  }

  if (target.is_private) {
    const { data: follows } = await db
      .from("follows")
      .select("id")
      .eq("follower_id", viewer.id)
      .eq("following_id", target.id)
      .maybeSingle();
    if (!follows) {
      return json({ ok: true, data: { kind: "unavailable", label: null } });
    }
  }

  // A numeric distance is only available for a target who explicitly opted in
  // and proved they are an adult. Otherwise the client may display the same
  // public city text it already had, but never a fabricated centroid mileage.
  if (!target.auth_id || !(await hasAdultVerification(db, String(target.auth_id)))) {
    return json({
      ok: true,
      data: { kind: "city", label: target.location ? `In ${target.location}` : null },
    });
  }

  const { data: targetPresence } = await db
    .from("member_proximity_presence")
    .select("latitude, longitude, share_until")
    .eq("user_id", target.auth_id)
    .gt("share_until", new Date().toISOString())
    .maybeSingle();

  if (!targetPresence) {
    return json({
      ok: true,
      data: { kind: "city", label: target.location ? `In ${target.location}` : null },
    });
  }

  let viewerLatitude = finiteCoord(body?.viewerLatitude, -90, 90);
  let viewerLongitude = finiteCoord(body?.viewerLongitude, -180, 180);
  if (viewerLatitude === null || viewerLongitude === null) {
    const { data: ownPresence } = await db
      .from("member_proximity_presence")
      .select("latitude, longitude")
      .eq("user_id", authUserId)
      .gt("share_until", new Date().toISOString())
      .maybeSingle();
    viewerLatitude = ownPresence?.latitude ?? null;
    viewerLongitude = ownPresence?.longitude ?? null;
  }

  if (viewerLatitude === null || viewerLongitude === null) {
    return json({
      ok: true,
      data: { kind: "city", label: target.location ? `In ${target.location}` : null },
    });
  }

  const miles = roundedMiles(
    haversineMiles(
      viewerLatitude,
      viewerLongitude,
      Number(targetPresence.latitude),
      Number(targetPresence.longitude),
    ),
  );
  const label = miles <= 0.2 ? "Nearby" : `${miles} miles away`;
  return json({
    ok: true,
    data: {
      kind: "distance",
      miles,
      label,
    },
  });
});
