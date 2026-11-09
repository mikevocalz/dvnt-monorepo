/** Server-private device positions. Exact distances require reciprocal, explicit
 * v2 consent for the current live sign-in. Legacy consent remains bands only.
 * Repeated exact measurements may reveal location; the consent UI discloses it. */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyLocationSession } from "../_shared/location-session.ts";
import { resolveOrProvisionUser } from "../_shared/resolve-user.ts";
import { resolveVerifiedAdmission } from "../_shared/verified-admission.ts";
import { consumeDbRateLimit } from "../_shared/db-rate-limit.ts";
import { checkAdultBirthDate } from "../_shared/age-policy.ts";

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

/** Own-position changes a member may make. Each move is one trilateration probe. */
const PUBLISH_MOVES_PER_HOUR = 4;
const PUBLISH_MOVES_PER_DAY = 12;

function finiteCoord(value: unknown, min: number, max: number): number | null {
  // Only a number or a numeric string is a coordinate. `Number()` turns null,
  // "" and [] into 0 — a real position off the coast of Africa — and true into
  // 1, so the type is checked before the range rather than after coercion.
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (typeof value === "string" && value.trim() === "") return null;
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

/** Legacy grants remain coarse. Bands also carry location-inference risk. */
type ProximityBand = "under_1" | "1_5" | "5_15" | "15_50" | "far";

const BAND_LABELS: Record<ProximityBand, string> = {
  under_1: "Less than a mile away",
  "1_5": "A few miles away",
  "5_15": "Across town",
  "15_50": "Nearby area",
  far: "Far away",
};

function bandForMiles(miles: number): ProximityBand {
  if (miles < 1) return "under_1";
  if (miles < 5) return "1_5";
  if (miles < 15) return "5_15";
  if (miles < 50) return "15_50";
  return "far";
}

async function hasAdultVerification(db: any, userId: string) {
  const { data, error } = await db
    .from("identity_verifications")
    .select("status, date_of_birth")
    .eq("user_id", userId)
    .maybeSingle();
  if (error || data?.status !== "passed" || !data?.date_of_birth) return false;
  // The canonical boundary helper, not local date math. Subtracting 18 from
  // getUTCFullYear() rolls a nonexistent 29 Feb forward, which on 2028-02-29
  // admitted a 2010-03-01 date of birth: age 17.
  return checkAdultBirthDate(data.date_of_birth).allowed;
}

async function exactConsent(db: any, userId: string, sessionId?: string) {
  const { data, error } = await db.from("member_exact_distance_consent")
    .select("session_id, expires_at, consent_version").eq("user_id", userId).maybeSingle();
  if (error || data?.consent_version !== 2 || (sessionId && data.session_id !== sessionId) ||
      !(Date.parse(data.expires_at) > Date.now())) return null;
  const { data: live, error: sessionError } = await db.from("session")
    .select("id, userId, expiresAt").eq("id", data.session_id).eq("userId", userId).maybeSingle();
  if (sessionError || !live || !(Date.parse(live.expiresAt) > Date.now())) return null;
  return Math.min(Date.parse(live.expiresAt), Date.parse(data.expires_at));
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

  const session = await verifyLocationSession(db, req);
  if (!session.ok) {
    return json({ ok: false, error: "Unauthorized" }, 401);
  }
  const authUserId = session.userId;

  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  const action = typeof body?.action === "string" ? body.action : "";
  if (!action) return json({ ok: false, error: "Missing action" }, 400);

  if (body?.expectedAuthId !== undefined && body.expectedAuthId !== authUserId) {
    return json({ ok: false, error: "Account changed" }, 409);
  }
  if (action === "publish" && body?.exactDistanceVersion === 2 &&
      (body.expectedAuthId !== authUserId || body.expectedSessionId !== session.sessionId)) {
    return json({ ok: false, error: "Sign-in changed" }, 409);
  }
  if ((action === "consentExact" || action === "revokeExact") && body?.expectedAuthId !== authUserId) {
    return json({ ok: false, error: "Account changed" }, 409);
  }
  if (action === "consentExact" && body?.expectedSessionId !== session.sessionId) {
    return json({ ok: false, error: "Sign-in changed" }, 409);
  }

  // Withdrawal of location consent must work even when identity verification
  // expired, the account was suspended, or the admission policy changed.
  // A user never has to earn permission to STOP sharing their coordinates.
  if (action === "revoke" || action === "revokeExact") {
    const { error: consentError } = await db.from("member_exact_distance_consent").delete().eq("user_id", authUserId);
    if (consentError) return json({ ok: false, error: "Could not withdraw exact distance consent" }, 503);
    const { error } = await db.from("member_proximity_presence")
      .delete().eq("user_id", authUserId);
    if (error) {
      console.error("[member-proximity] revoke failed:", error.code);
      return json({ ok: false, error: "Could not stop proximity sharing. Please retry." }, 503);
    }
    return json({ ok: true, data: { revoked: true } });
  }

  const admission = await resolveVerifiedAdmission(db, authUserId);
  if (admission.state === "blocked") {
    return json(
      { ok: false, error: admission.message || "Adult verification is required", code: admission.reason },
      403,
    );
  }

  if (action === "consentExact") {
    if (body?.consentVersion !== 2 || !(await hasAdultVerification(db, authUserId))) {
      return json({ ok: false, error: "Explicit v2 adult consent is required" }, 403);
    }
    const { data: master, error: masterError } = await db.from("member_map_settings")
      .select("location_enabled").eq("user_id", authUserId).maybeSingle();
    if (masterError || master?.location_enabled !== true) return json({ ok: false, error: "Enable location first" }, 403);
    const { error } = await db.from("member_exact_distance_consent").upsert({
      user_id: authUserId, session_id: session.sessionId, consent_version: 2,
      expires_at: session.expiresAt, consented_at: new Date().toISOString(),
    }, { onConflict: "user_id" });
    if (error) return json({ ok: false, error: "Could not save consent" }, 503);
    return json({ ok: true, data: { expiresAt: session.expiresAt, consentVersion: 2 } });
  }

  if (action === "publish") {
    const adult = await hasAdultVerification(db, authUserId);
    if (!adult) {
      return json(
        { ok: false, error: "Verify that you are 18+ before sharing member proximity.", code: "adult_verification_required" },
        403,
      );
    }

    const { data: master, error: masterError } = await db.from("member_map_settings")
      .select("location_enabled").eq("user_id", authUserId).maybeSingle();
    if (masterError || master?.location_enabled !== true) return json({ ok: false, error: "Enable location first" }, 403);
    const exactUntil = body?.exactDistanceVersion === 2
      ? await exactConsent(db, authUserId, session.sessionId) : null;
    if (body?.exactDistanceVersion === 2 && !exactUntil) return json({ ok: false, error: "Live exact distance consent required" }, 403);
    const observedAt = typeof body?.observedAt === "string" ? Date.parse(body.observedAt) : NaN;
    if (exactUntil && (!Number.isFinite(observedAt) || observedAt < Date.now() - 60_000 || observedAt > Date.now() + 5_000)) {
      return json({ ok: false, error: "Fresh device observation required" }, 400);
    }
    const precision = exactUntil ? (n: number) => Math.round(n * 100000) / 100000 : quantize;
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

    // Only a moved point is a new probe. Renewing or shortening the grant at
    // the same quantized position does not spend the limit.
    const { data: current, error: currentError } = await db
      .from("member_proximity_presence")
      .select("latitude, longitude, exact_observed_at")
      .eq("user_id", authUserId)
      .maybeSingle();
    if (currentError) {
      console.error("[member-proximity] presence read failed:", currentError.code);
      return json({ ok: false, error: "Could not update proximity sharing" }, 503);
    }
    if (exactUntil && current?.exact_observed_at && observedAt <= Date.parse(current.exact_observed_at)) {
      return json({ ok: false, error: "A newer device observation is required" }, 409);
    }
    const moved = !current ||
      Number(current.latitude) !== precision(latitude) ||
      Number(current.longitude) !== precision(longitude);
    if (moved) {
      for (const [action, max, windowSeconds] of [
        ["member-proximity-move-hour", PUBLISH_MOVES_PER_HOUR, 60 * 60],
        ["member-proximity-move-day", PUBLISH_MOVES_PER_DAY, 24 * 60 * 60],
      ] as const) {
        const limit = await consumeDbRateLimit(db, authUserId, action, max, windowSeconds);
        if (limit.error) {
          console.error("[member-proximity] publish rate limit check failed:", limit.error);
          return json({ ok: false, error: "Could not update proximity sharing" }, 503);
        }
        if (!limit.allowed) {
          return json({ ok: false, error: "Location updated too often. Try again later." }, 429);
        }
      }
    }

    const cityId = Number(body?.cityId);
    const accuracyMeters = Number(body?.accuracyMeters);
    const sharedUntil = new Date(Math.min(shareUntil, Date.parse(session.expiresAt),
      exactUntil ? Math.min(exactUntil, observedAt + 15 * 60_000) : Infinity)).toISOString();
    const { error } = await db.from("member_proximity_presence").upsert(
      {
        user_id: authUserId,
        city_id: Number.isSafeInteger(cityId) && cityId > 0 ? cityId : null,
        latitude: precision(latitude),
        longitude: precision(longitude),
        accuracy_meters:
          Number.isFinite(accuracyMeters) && accuracyMeters >= 0
            ? Math.min(accuracyMeters, 50_000)
            : null,
        share_until: sharedUntil,
        exact_observed_at: exactUntil ? new Date(observedAt).toISOString() : null,
        exact_session_id: exactUntil ? session.sessionId : null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );
    if (error) {
      console.error("[member-proximity] publish failed:", error.message);
      return json({ ok: false, error: "Could not update proximity sharing" }, 500);
    }
    return json({ ok: true, data: { sharedUntil } });
  }

  if (action !== "distance") {
    return json({ ok: false, error: "Unknown action" }, 400);
  }

  const rate = await consumeDbRateLimit(db, authUserId, "member-proximity-distance", 120, 10 * 60);
  if (rate.error) {
    console.error("[member-proximity] distance rate limit check failed:", rate.error);
    return json({ ok: false, error: "Proximity is unavailable right now" }, 503);
  }
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
  // An unreadable block relationship cannot be interpreted as permission.
  if (blockedForward.error || blockedReverse.error ||
      blockedForward.data || blockedReverse.data) {
    return json({ ok: true, data: { kind: "unavailable", label: null } });
  }

  if (target.is_private) {
    const { data: follows, error: followError } = await db
      .from("follows")
      .select("id")
      .eq("follower_id", viewer.id)
      .eq("following_id", target.id)
      .maybeSingle();
    if (followError || !follows) {
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

  const targetAdmission = await resolveVerifiedAdmission(db, String(target.auth_id));
  if (targetAdmission.state === "blocked") return json({ ok: true, data: { kind: "unavailable", label: null } });

  // A pre-migration legacy point does not bypass the overall location master.
  const masters = await Promise.all([authUserId, String(target.auth_id)].map((id) =>
    db.from("member_map_settings").select("location_enabled").eq("user_id", id).maybeSingle()
  ));
  if (masters.some((result) => result.error || result.data?.location_enabled !== true)) {
    return json({ ok: true, data: { kind: "unavailable", label: null } });
  }

  const { data: targetPresence } = await db
    .from("member_proximity_presence")
    .select("latitude, longitude, share_until, exact_session_id, exact_observed_at")
    .eq("user_id", target.auth_id)
    .gt("share_until", new Date().toISOString())
    .maybeSingle();

  if (!targetPresence) {
    return json({
      ok: true,
      data: { kind: "city", label: target.location ? `In ${target.location}` : null },
    });
  }

  // The viewer's position is read, not accepted. `viewerLatitude` and
  // `viewerLongitude` in the body are ignored; a viewer without a live grant of
  // their own gets the city-level answer, which also makes the read reciprocal:
  // the target needed a live row above, and so does the viewer.
  const { data: ownPresence } = await db
    .from("member_proximity_presence")
    .select("latitude, longitude, share_until, exact_session_id, exact_observed_at")
    .eq("user_id", authUserId)
    .gt("share_until", new Date().toISOString())
    .maybeSingle();

  const viewerLatitude = finiteCoord(ownPresence?.latitude, -90, 90);
  const viewerLongitude = finiteCoord(ownPresence?.longitude, -180, 180);
  if (viewerLatitude === null || viewerLongitude === null) {
    return json({
      ok: true,
      data: { kind: "city", label: target.location ? `In ${target.location}` : null },
    });
  }

  const targetLatitude = finiteCoord(targetPresence.latitude, -90, 90);
  const targetLongitude = finiteCoord(targetPresence.longitude, -180, 180);
  const unavailable = () => json({ ok: true, data: { kind: "unavailable", label: null } });
  if (targetLatitude === null || targetLongitude === null ||
      !(await hasAdultVerification(db, authUserId))) return unavailable();
  const now = Date.now();
  if (!(Date.parse(ownPresence.share_until) > now) || !(Date.parse(targetPresence.share_until) > now)) return unavailable();
  const hasExactPoint = ownPresence.exact_session_id != null || targetPresence.exact_session_id != null ||
    ownPresence.exact_observed_at != null || targetPresence.exact_observed_at != null;
  let exactExpires: number | null = null;
  if (hasExactPoint) {
    // Never downgrade a v2 point to a band after its consent or session fails.
    // Only two independent legacy snapshots may enter the coarse path below.
    if (!ownPresence.exact_session_id || !targetPresence.exact_session_id ||
        ownPresence.exact_session_id !== session.sessionId) return unavailable();
    const observations = [ownPresence, targetPresence].map(p => Date.parse(p.exact_observed_at));
    if (observations.some(t => !Number.isFinite(t) || t > now + 5_000 || t + 15 * 60_000 <= now)) return unavailable();
    const [viewerExact, targetExact] = await Promise.all([
      exactConsent(db, authUserId, session.sessionId),
      exactConsent(db, String(target.auth_id), targetPresence.exact_session_id),
    ]);
    if (!viewerExact || !targetExact) return unavailable();
    exactExpires = Math.min(viewerExact, targetExact, Date.parse(ownPresence.share_until),
      Date.parse(targetPresence.share_until), ...observations.map(t => t + 15 * 60_000), now + 30_000);
  }
  const miles = haversineMiles(viewerLatitude, viewerLongitude, targetLatitude, targetLongitude);
  if (exactExpires !== null) {
    return json({ ok: true, data: { kind: "distance", consentVersion: 2,
      miles: Number(miles.toFixed(2)), label: `${miles.toFixed(2)} miles away`, expiresAt: new Date(exactExpires).toISOString() } });
  }
  const band = bandForMiles(miles);
  return json({
    ok: true,
    data: {
      kind: "distance",
      band,
      label: BAND_LABELS[band],
    },
  });
});
