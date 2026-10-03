import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  verifySession,
  jsonResponse,
  errorResponse,
  optionsResponse,
} from "../_shared/verify-session.ts";
import { resolveOrProvisionUser } from "../_shared/resolve-user.ts";
import { resolveAdultVerificationState } from "../_shared/verification-state.ts";
import { firstPostRefusal } from "../_shared/first-post-gate.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const CAMPAIGN = "first_ticket_v1";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Action = "resolve" | "accept" | "dismiss";

function isAdmission(row: { category?: string | null }) {
  return row.category == null || row.category === "admission";
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return optionsResponse();
  if (req.method !== "POST") return errorResponse("Method not allowed", 405);

  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` } },
  });

  const authId = await verifySession(db, req);
  if (!authId) return errorResponse("Unauthorized", 401);

  let body: { action?: Action; cartId?: string } = {};
  try {
    body = await req.json();
  } catch {
    return errorResponse("Invalid JSON", 400);
  }
  const action: Action = body.action === "accept" || body.action === "dismiss"
    ? body.action
    : "resolve";

  const member = await resolveOrProvisionUser(db, authId, "id,auth_id");
  if (!member?.id) return errorResponse("Member profile not found", 404);
  const intId = String(member.id);
  const candidates = intId === authId ? [authId] : [authId, intId];

  const { data: existing, error: existingError } = await db
    .from("first_post_offers")
    .select("id,user_id,event_id,ticket_id,cart_id,state,created_at")
    .eq("user_id", authId)
    .eq("campaign_version", CAMPAIGN)
    .maybeSingle();
  if (existingError) {
    console.error("[first-post-offer] existing read failed", existingError);
    return errorResponse("Could not load first-post offer", 500);
  }

  // R04: the ticket post goes out only after adult verification. Checked
  // before anything is offered, accepted or inserted, so an unverified member
  // keeps an untouched offer they can take once their ID is approved. Dismiss
  // stays open: saying no never needs verification.
  const verificationGate = async () => {
    const verification = await resolveAdultVerificationState(db, authId);
    return firstPostRefusal({ verificationState: verification.state });
  };

  if (action === "accept" || action === "dismiss") {
    if (!existing) return jsonResponse({ ok: true, offer: null, reason: "not_offered" });
    if (existing.state !== "offered") {
      return jsonResponse({ ok: true, offer: null, reason: existing.state });
    }
    if (action === "accept") {
      const refusal = await verificationGate();
      if (refusal) return jsonResponse({ ok: true, offer: null, reason: refusal.code, message: refusal.message });
    }
    const now = new Date().toISOString();
    const patch = action === "accept"
      ? { state: "accepted", accepted_at: now, updated_at: now }
      : { state: "dismissed", dismissed_at: now, updated_at: now };
    const { data: changed, error } = await db
      .from("first_post_offers")
      .update(patch)
      .eq("id", existing.id)
      .eq("state", "offered")
      .select("id,state,event_id")
      .maybeSingle();
    if (error) return errorResponse("Could not update first-post offer", 500);
    return jsonResponse({
      ok: true,
      offer: changed ?? null,
      reason: changed ? action : "already_resolved",
    });
  }

  // Once resolved, this campaign never becomes a second opportunity on another
  // device/reinstall. An outstanding offer may be rendered again until the
  // member accepts or dismisses it.
  if (existing && existing.state !== "offered") {
    return jsonResponse({ ok: true, offer: null, reason: existing.state });
  }

  const refusal = await verificationGate();
  if (refusal) return jsonResponse({ ok: true, offer: null, reason: refusal.code, message: refusal.message });

  const cartId = String(body.cartId || "").trim();
  if (!UUID_RE.test(cartId)) {
    return jsonResponse({ ok: true, offer: null, reason: "invalid_cart" });
  }

  const { data: cart } = await db
    .from("carts")
    .select("id,user_id,status")
    .eq("id", cartId)
    .maybeSingle();
  if (!cart || cart.user_id !== authId || cart.status !== "completed") {
    return jsonResponse({ ok: true, offer: null, reason: "cart_not_completed" });
  }

  // Existing published content means this is not a first-post onboarding case.
  const { data: priorPost, error: priorPostError } = await db
    .from("posts")
    .select("id")
    .eq("author_id", member.id)
    .limit(1)
    .maybeSingle();
  if (priorPostError) return errorResponse("Could not inspect prior posts", 500);
  if (priorPost) {
    return jsonResponse({ ok: true, offer: null, reason: "already_posted" });
  }

  const { data: cartTickets, error: ticketsError } = await db
    .from("tickets")
    .select("id,event_id,category,status,created_at,cart_id")
    .eq("cart_id", cartId)
    .in("user_id", candidates)
    .in("status", ["active", "scanned"])
    .order("created_at", { ascending: true });
  if (ticketsError) return errorResponse("Could not inspect issued tickets", 500);

  const ticket = (cartTickets || []).find(isAdmission);
  if (!ticket) {
    return jsonResponse({ ok: true, offer: null, reason: "no_admission_ticket" });
  }

  // Prove this ticket is the first valid admission, not merely the first ticket
  // in the current cart. This makes retries/devices/webhook replays converge.
  // A failed read proves nothing, so it must not fall through to "no prior
  // admission" and burn the once-per-member offer on the wrong ticket.
  const { data: older, error: olderError } = await db
    .from("tickets")
    .select("id,category,status,created_at")
    .in("user_id", candidates)
    .in("status", ["active", "scanned"])
    .lt("created_at", ticket.created_at)
    .order("created_at", { ascending: false })
    .limit(25);
  if (olderError) return errorResponse("Could not inspect prior tickets", 500);
  if ((older || []).some(isAdmission)) {
    return jsonResponse({ ok: true, offer: null, reason: "prior_admission" });
  }

  const { data: event, error: eventError } = await db
    .from("events")
    .select("id,title,visibility,status,cities(name)")
    .eq("id", ticket.event_id)
    .maybeSingle();
  if (eventError || !event) {
    return jsonResponse({ ok: true, offer: null, reason: "event_unavailable" });
  }
  if (event.visibility !== "public" || (event.status && event.status !== "active")) {
    return jsonResponse({ ok: true, offer: null, reason: "event_not_public" });
  }

  let offer = existing;
  if (!offer) {
    const { data: inserted, error } = await db
      .from("first_post_offers")
      .insert({
        user_id: authId,
        campaign_version: CAMPAIGN,
        event_id: event.id,
        ticket_id: ticket.id,
        cart_id: cartId,
        state: "offered",
      })
      .select("id,user_id,event_id,ticket_id,cart_id,state,created_at")
      .single();
    if (error?.code === "23505") {
      const { data: raced } = await db
        .from("first_post_offers")
        .select("id,user_id,event_id,ticket_id,cart_id,state,created_at")
        .eq("user_id", authId)
        .eq("campaign_version", CAMPAIGN)
        .maybeSingle();
      offer = raced;
    } else if (error) {
      console.error("[first-post-offer] insert failed", error);
      return errorResponse("Could not create first-post offer", 500);
    } else {
      offer = inserted;
    }
  }

  if (!offer || offer.state !== "offered") {
    return jsonResponse({ ok: true, offer: null, reason: offer?.state || "already_resolved" });
  }

  const city = Array.isArray(event.cities) ? event.cities[0] : event.cities;
  return jsonResponse({
    ok: true,
    offer: {
      id: offer.id,
      event: {
        id: Number(event.id),
        title: event.title,
        visibility: event.visibility,
        cityName: city?.name ?? null,
      },
    },
    reason: "offered",
  });
});
