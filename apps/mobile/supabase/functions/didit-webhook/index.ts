/**
 * Didit Webhook Handler (Edge Function)
 *
 * Lands identity-verification events into identity_verifications, the same
 * provider-neutral shape the app reads via is_verified*/is_verified_self (I3).
 * Schema: 20260630130000_identity_verifications.sql.
 *
 * Contract — VERIFIED against Didit's official demo
 * (github.com/didit-protocol/didit-full-demo, src/app/api/verification/webhook/route.ts):
 *
 *   SIGNATURE — three headers may be sent; we verify the "simple" scheme
 *   first (immune to JSON re-encoding), then fall back to the raw-body scheme:
 *     x-signature-simple : HMAC-SHA256(secret, "{created_at}:{session_id}:{status}:{webhook_type}")
 *     x-signature        : HMAC-SHA256(secret, <raw request body>)
 *   Both hex-encoded, compared constant-time. `created_at` (unix seconds) must
 *   be within 300s of now (replay guard).
 *
 *   PAYLOAD — { session_id, status, vendor_data, created_at, webhook_type }.
 *   `vendor_data` is the DVNT user_id we sent at session-create (I1 binding).
 *
 *   STATUS enum: Not Started, In Progress, Approved, Declined, In Review,
 *   Expired, Abandoned, KYC Expired. `Approved` is the pass.
 *
 * Everything OUTSIDE the Didit seams (dedup, monotonic upsert, anon-id
 * refusal) mirrors the stripe / persona webhooks.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const DIDIT_WEBHOOK_SECRET = Deno.env.get("DIDIT_WEBHOOK_SECRET") || "";

type DiditEvent = {
  session_id?: string;
  status?: string;
  vendor_data?: string;
  created_at?: number | string;
  webhook_type?: string;
  // Optional decision detail, present on some events.
  decision?: {
    id_verification?: {
      date_of_birth?: string | null;
      issuing_country?: string | null;
    };
  };
};

// Map Didit status → identity_verifications.status.
function statusFromEvent(name: string | undefined): string | null {
  switch (name) {
    case "Approved":
      return "passed";
    case "Declined":
      return "failed";
    case "Expired":
    case "KYC Expired":
    case "Abandoned":
      return "expired";
    case "In Review":
      return "review";
    case "In Progress":
    case "Not Started":
      return "submitted";
    default:
      return null;
  }
}

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message)),
  );
  return Array.from(mac)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }
  if (!DIDIT_WEBHOOK_SECRET) {
    console.error("[didit-webhook] DIDIT_WEBHOOK_SECRET not configured — rejecting");
    return new Response("Server misconfigured", { status: 500 });
  }

  const rawBody = await req.text();
  let ev: DiditEvent;
  try {
    ev = JSON.parse(rawBody) as DiditEvent;
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const createdAt =
    typeof ev.created_at === "string" ? Number(ev.created_at) : ev.created_at;
  if (!createdAt || !Number.isFinite(createdAt)) {
    return new Response("Missing created_at", { status: 400 });
  }
  // I5-parallel — replay guard: reject stale events.
  if (Math.abs(Math.floor(Date.now() / 1000) - createdAt) > 300) {
    return new Response("Stale event", { status: 400 });
  }

  // I4 — signature verify, fail closed. Prefer the "simple" field-based scheme.
  const sigSimple = req.headers.get("x-signature-simple");
  const sigRaw = req.headers.get("x-signature");
  let okSig = false;
  if (sigSimple) {
    const canonical = [
      String(createdAt),
      String(ev.session_id ?? ""),
      String(ev.status ?? ""),
      String(ev.webhook_type ?? ""),
    ].join(":");
    okSig = timingSafeEqualHex(
      await hmacHex(DIDIT_WEBHOOK_SECRET, canonical),
      sigSimple.toLowerCase(),
    );
  }
  if (!okSig && sigRaw) {
    okSig = timingSafeEqualHex(
      await hmacHex(DIDIT_WEBHOOK_SECRET, rawBody),
      sigRaw.toLowerCase(),
    );
  }
  if (!okSig) {
    return new Response("Invalid signature", { status: 400 });
  }

  const sessionId = ev.session_id ?? null;
  const referenceId = ev.vendor_data ?? null;
  const eventName = ev.status;

  if (!sessionId || !eventName) {
    return new Response("Malformed event", { status: 400 });
  }
  if (!referenceId) {
    // I1 — without our user_id we cannot bind this verification to a person.
    console.error(`[didit-webhook] missing vendor_data on ${eventName} ${sessionId} — refusing`);
    return new Response("Missing vendor_data", { status: 400 });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  // I2 — dedup. Didit sends no event id; synthesize one per (session, status)
  // so retries of the same transition are idempotent while state changes pass.
  const eventId = `didit:${sessionId}:${eventName}`;
  const { error: dedupErr } = await supabase.from("verification_events").insert({
    event_id: eventId,
    provider: "didit",
    user_id: referenceId,
    provider_ref: sessionId,
    event_type: eventName,
    payload: ev,
  });
  if (dedupErr && dedupErr.code === "23505") {
    return new Response("ok", { status: 200 }); // already processed
  }
  if (dedupErr) {
    console.error("[didit-webhook] dedup insert error", dedupErr);
    return new Response("Server error", { status: 500 });
  }

  const nextStatus = statusFromEvent(eventName);
  if (!nextStatus) {
    return new Response("ok", { status: 200 }); // not a state-moving event
  }

  const dob = ev.decision?.id_verification?.date_of_birth ?? null;
  const country = ev.decision?.id_verification?.issuing_country ?? null;

  const { error: rpcErr } = await supabase.rpc("upsert_identity_verification", {
    p_user_id: referenceId,
    p_provider: "didit",
    p_provider_ref: sessionId,
    p_status: nextStatus,
    p_doc_country: country,
    p_date_of_birth: dob,
    p_failure_code: null,
    p_failure_message: null,
    p_event_created_at: new Date(createdAt * 1000).toISOString(),
  });

  if (rpcErr) {
    console.error("[didit-webhook] upsert error", rpcErr);
    return new Response("Server error", { status: 500 });
  }

  return new Response("ok", { status: 200 });
});
