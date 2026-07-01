/**
 * Persona Webhook Handler (Edge Function)
 *
 * Lands identity-verification events into the same shape the app reads
 * via `is_verified(uid)` (I3). The schema lives in
 * `20260630130000_identity_verifications.sql`.
 *
 * ⚠ PERSONA-VERIFY (do NOT ship to prod without verifying these against
 *   the authoritative Persona docs — they 404'd from the build-out
 *   research environment):
 *
 *   1. SIGNATURE SCHEME
 *      Public excerpts indicate Persona sends a `Persona-Signature`
 *      header whose value is an HMAC-SHA256 over the *raw request body*,
 *      keyed by the per-webhook secret, encoded as hex, possibly
 *      prefixed with `t=<timestamp> v1=<hex>` (Stripe-style). Until
 *      verified, this handler uses a TIMING-SAFE comparison against a
 *      constructed `v1=<hex>` string and treats a header that doesn't
 *      contain a `v1=` segment as a failure. Verify against
 *      docs.withpersona.com/webhooks before going live.
 *
 *   2. EVENT TYPE NAMES
 *      Used here: `inquiry.approved`, `inquiry.declined`,
 *      `inquiry.completed`, `inquiry.expired`, `inquiry.marked-for-review`.
 *      These names are CONSISTENT with Persona's resource model (JSON:API
 *      with dashed keys) but the exact strings need confirmation.
 *
 *   3. PAYLOAD FIELD PATHS
 *      Used here: `data.attributes.payload.data.attributes.reference-id`
 *      (the per-event payload wraps the Inquiry resource) — Persona's
 *      webhook envelope is JSON:API-shaped but the depth needs
 *      confirmation. If the actual envelope is shallower we read the
 *      fallback at `data.attributes.reference-id`.
 *
 * Everything OUTSIDE the Persona-specific seams (dedup, monotonic
 * upsert, anon-id refusal) is identical to the stripe + revenuecat
 * webhooks and IS production-ready.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const PERSONA_WEBHOOK_SECRET = Deno.env.get("PERSONA_WEBHOOK_SECRET") || "";

type PersonaEvent = {
  // JSON:API envelope — top-level `data` carries the event meta.
  data?: {
    id?: string;
    type?: string; // 'event'
    attributes?: {
      // Event type (e.g. 'inquiry.approved'). PERSONA-VERIFY.
      name?: string;
      "created-at"?: string;
      payload?: {
        // The Inquiry resource snapshot at the time of the event.
        data?: {
          id?: string; // inq_*
          type?: string; // 'inquiry'
          attributes?: {
            "reference-id"?: string;
            status?: string;
            "created-at"?: string;
            "completed-at"?: string;
            "expired-at"?: string;
            // Surfaced when status moves to a terminal failure state.
            "failure-reason"?: string | null;
            "decline-reason"?: string | null;
            // Often present on completed/approved events.
            fields?: {
              "birthdate"?: { value?: string | null };
              "country-code"?: { value?: string | null };
            };
          };
        };
      };
    };
  };
  // PERSONA-VERIFY: some Persona docs show a flatter envelope without
  // the outer `payload` wrapping. We read this as a fallback.
  inquiry?: {
    id?: string;
    "reference-id"?: string;
  };
};

// Map Persona event name → identity_verifications.status.
function statusFromEvent(name: string | undefined): string | null {
  switch (name) {
    case "inquiry.approved":
      return "passed";
    case "inquiry.declined":
      return "failed";
    case "inquiry.expired":
      return "expired";
    case "inquiry.marked-for-review":
      return "review";
    case "inquiry.completed":
      // 'completed' on its own is the user-finished-the-flow signal; the
      // pass/fail decision arrives on a subsequent approved/declined.
      return "submitted";
    default:
      return null;
  }
}

async function verifyPersonaSignature(
  rawBody: string,
  signatureHeader: string,
  secret: string,
): Promise<boolean> {
  // PERSONA-VERIFY: scheme.
  // The header format we accept is `t=<ts> v1=<hex>` (Stripe-style) or
  // bare `v1=<hex>`. We compute HMAC-SHA256(secret, rawBody) and compare
  // hex-encoded values constant-time.
  const match = /v1=([0-9a-f]+)/i.exec(signatureHeader);
  if (!match) return false;
  const claimed = match[1].toLowerCase();

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const macBytes = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody)),
  );
  const expected = Array.from(macBytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  if (expected.length !== claimed.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ claimed.charCodeAt(i);
  }
  return diff === 0;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }
  if (!PERSONA_WEBHOOK_SECRET) {
    console.error(
      "[persona-webhook] PERSONA_WEBHOOK_SECRET not configured — rejecting",
    );
    return new Response("Server misconfigured", { status: 500 });
  }

  const rawBody = await req.text();

  // I4 — signature verify, fail closed. PERSONA-VERIFY: header name.
  const sigHeader =
    req.headers.get("persona-signature") ?? req.headers.get("Persona-Signature") ?? "";
  if (!sigHeader) {
    return new Response("Missing signature", { status: 400 });
  }
  const okSig = await verifyPersonaSignature(rawBody, sigHeader, PERSONA_WEBHOOK_SECRET);
  if (!okSig) {
    return new Response("Invalid signature", { status: 400 });
  }

  let ev: PersonaEvent;
  try {
    ev = JSON.parse(rawBody) as PersonaEvent;
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const eventId = ev.data?.id;
  const eventName = ev.data?.attributes?.name;
  const eventCreatedAt = ev.data?.attributes?.["created-at"];
  const inquiry = ev.data?.attributes?.payload?.data?.attributes ?? null;
  const inquiryId = ev.data?.attributes?.payload?.data?.id ?? ev.inquiry?.id ?? null;
  const referenceId =
    inquiry?.["reference-id"] ?? ev.inquiry?.["reference-id"] ?? null;

  if (!eventId || !eventName || !eventCreatedAt) {
    return new Response("Malformed event", { status: 400 });
  }
  if (!referenceId) {
    // I1 — without our user_id we cannot bind this verification to a
    // person. Refuse to provision (vs. accept and orphan the row).
    console.error(
      `[persona-webhook] missing reference-id on ${eventName} ${eventId} — refusing`,
    );
    return new Response("Missing reference-id", { status: 400 });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  // I2 — dedup on event id.
  const { error: dedupErr } = await supabase
    .from("verification_events")
    .insert({
      event_id: eventId,
      provider: "persona",
      user_id: referenceId,
      provider_ref: inquiryId,
      event_type: eventName,
      payload: ev,
    });
  if (dedupErr && dedupErr.code === "23505") {
    return new Response("ok", { status: 200 }); // already processed
  }
  if (dedupErr) {
    console.error("[persona-webhook] dedup insert error", dedupErr);
    return new Response("Server error", { status: 500 });
  }

  const nextStatus = statusFromEvent(eventName);
  if (!nextStatus) {
    // Not an event that moves verification state — acked.
    return new Response("ok", { status: 200 });
  }

  const dob = inquiry?.fields?.birthdate?.value ?? null;
  const country = inquiry?.fields?.["country-code"]?.value ?? null;
  const failureMessage =
    inquiry?.["failure-reason"] ?? inquiry?.["decline-reason"] ?? null;

  const { data: applied, error: rpcErr } = await supabase.rpc(
    "upsert_identity_verification",
    {
      p_user_id: referenceId,
      p_provider: "persona",
      p_provider_ref: inquiryId,
      p_status: nextStatus,
      p_doc_country: country,
      p_date_of_birth: dob,
      p_failure_code: null,
      p_failure_message: failureMessage,
      p_event_created_at: eventCreatedAt,
    },
  );

  if (rpcErr) {
    console.error("[persona-webhook] upsert RPC error", rpcErr);
    return new Response("Server error", { status: 500 });
  }
  if (applied === false) {
    console.log(
      `[persona-webhook] stale event skipped for ${referenceId} (${eventId})`,
    );
  } else {
    console.log(
      `[persona-webhook] ${eventName} for ${referenceId}: ${nextStatus}`,
    );
  }

  return new Response("ok", { status: 200 });
});
