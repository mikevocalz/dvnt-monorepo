/**
 * Didit Webhook Handler (Edge Function)
 *
 * Lands identity-verification events into identity_verifications, the same
 * provider-neutral shape the app reads via is_verified / is_verified_self (I3).
 * Schema: 20260630130000_identity_verifications.sql.
 *
 * Contract — VERIFIED against Didit's webhook docs (docs.didit.me/integration/webhooks):
 *
 *   SIGNATURE — Didit sends every scheme on every delivery. We verify a
 *   BODY-authenticating one (V2 or raw) and only fall back to "simple" when
 *   neither is present — "simple" covers just the envelope, not the decision.
 *     x-signature-v2     : HMAC-SHA256(secret, canonical JSON = keys sorted,
 *                          compact separators, Unicode preserved). Survives
 *                          proxy re-encoding. Recommended.
 *     x-signature        : HMAC-SHA256(secret, <exact raw bytes>). Valid because
 *                          Deno's req.text() gives us the untouched body.
 *     x-signature-simple : HMAC-SHA256(secret, "{ts}:{session_id}:{status}:{webhook_type}")
 *   All hex, constant-time compared. Freshness from X-Timestamp header (falls
 *   back to body created_at/timestamp) must be within 300s (replay guard).
 *
 *   PAYLOAD — { event_id, session_id, status, vendor_data, created_at,
 *   timestamp, webhook_type, decision? }. `vendor_data` is the DVNT user_id we
 *   sent at session-create (I1 binding).
 *
 *   STATUS enum: Not Started, In Progress, Approved, Declined, In Review,
 *   Expired, Abandoned, KYC Expired, Resubmitted. `Approved` is the pass.
 *
 * Everything OUTSIDE the Didit seams (dedup, monotonic upsert, anon-id
 * refusal) mirrors the stripe / persona webhooks.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const DIDIT_WEBHOOK_SECRET = Deno.env.get("DIDIT_WEBHOOK_SECRET") || "";

type DiditEvent = {
  event_id?: string;
  session_id?: string;
  status?: string;
  vendor_data?: string;
  created_at?: number | string;
  timestamp?: number | string;
  webhook_type?: string;
  // Optional decision detail, present on some events.
  decision?: {
    id_verification?: {
      date_of_birth?: string | null;
      issuing_country?: string | null;
      first_name?: string | null;
      last_name?: string | null;
      full_name?: string | null;
    };
    // Newer payloads carry a plural array (docs.didit.me/reference/webhooks).
    id_verifications?: Array<{
      date_of_birth?: string | null;
      issuing_country?: string | null;
      first_name?: string | null;
      last_name?: string | null;
      full_name?: string | null;
    }>;
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
    case "Resubmitted": // reopened for another attempt — back to in-flight
      return "submitted";
    default:
      return null;
  }
}

// Didit x-signature-v2 canonical form: recursively key-sorted, compact-separator
// JSON with Unicode preserved (matches Python json.dumps sort_keys + ensure_ascii=False).
// JSON.stringify already uses `,`/`:` with no spaces and leaves non-ASCII unescaped.
function canonicalize(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonicalize);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort()) {
      out[k] = canonicalize((v as Record<string, unknown>)[k]);
    }
    return out;
  }
  return v;
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

  // Freshness from X-Timestamp header (falls back to body created_at/timestamp).
  const headerTs = Number(req.headers.get("x-timestamp"));
  const bodyTs = Number(ev.timestamp ?? ev.created_at);
  const eventTs = Number.isFinite(headerTs) && headerTs > 0 ? headerTs : bodyTs;
  if (!eventTs || !Number.isFinite(eventTs)) {
    return new Response("Missing timestamp", { status: 400 });
  }
  // I5-parallel — replay guard: reject stale events.
  if (Math.abs(Math.floor(Date.now() / 1000) - eventTs) > 300) {
    return new Response("Stale event", { status: 400 });
  }

  // I4 — signature verify, fail closed. Prefer a BODY-authenticating scheme
  // (v2 canonical, then raw bytes); "simple" only authenticates the envelope so
  // it is a last resort when no body-sig header is present.
  const sigV2 = req.headers.get("x-signature-v2");
  const sigRaw = req.headers.get("x-signature");
  const sigSimple = req.headers.get("x-signature-simple");
  let okSig = false;
  if (sigV2) {
    okSig = timingSafeEqualHex(
      await hmacHex(DIDIT_WEBHOOK_SECRET, JSON.stringify(canonicalize(ev))),
      sigV2.toLowerCase(),
    );
  }
  if (!okSig && sigRaw) {
    okSig = timingSafeEqualHex(
      await hmacHex(DIDIT_WEBHOOK_SECRET, rawBody),
      sigRaw.toLowerCase(),
    );
  }
  if (!okSig && !sigV2 && !sigRaw && sigSimple) {
    const canonical = [
      String(eventTs),
      String(ev.session_id ?? ""),
      String(ev.status ?? ""),
      String(ev.webhook_type ?? ""),
    ].join(":");
    okSig = timingSafeEqualHex(
      await hmacHex(DIDIT_WEBHOOK_SECRET, canonical),
      sigSimple.toLowerCase(),
    );
  }
  if (!okSig) {
    return new Response("Invalid signature", { status: 400 });
  }

  const sessionId = ev.session_id ?? null;
  const referenceId = ev.vendor_data ?? null;
  const eventName = ev.status;

  // Past signature verification the request is authentic. ACK 2xx for anything
  // we can't act on (console test pings, entity/transaction events, sessions
  // with no vendor_data) — making Didit retry an authenticated event just hangs
  // the destination. Only a bad signature (above) gets a non-2xx.
  if (!sessionId || !eventName) {
    console.info(`[didit-webhook] ack non-actionable ${ev.webhook_type ?? "?"} (no session/status)`);
    return new Response("ok", { status: 200 });
  }
  if (!referenceId) {
    // I1 — without our user_id we cannot bind this to a person; ack and move on.
    console.info(`[didit-webhook] ack ${eventName} ${sessionId} — no vendor_data`);
    return new Response("ok", { status: 200 });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  // I2 — dedup on Didit's event_id when present; else synthesize per
  // (session, webhook_type, status) so retries of a transition are idempotent
  // while genuine state changes still pass.
  const eventId = ev.event_id
    ? `didit:${ev.event_id}`
    : `didit:${sessionId}:${ev.webhook_type ?? "status.updated"}:${eventName}`;
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

  const idv =
    ev.decision?.id_verification ?? ev.decision?.id_verifications?.[0] ?? null;
  const dob = idv?.date_of_birth ?? null;
  const country = idv?.issuing_country ?? null;

  // One-account-per-person: the same document (normalized name + DOB) may not
  // verify a second account. Only the sha256 hash is stored — plaintext legal
  // names never persist. Collisions route to 'review', not auto-fail.
  const docName = (
    idv?.full_name ||
    [idv?.first_name, idv?.last_name].filter(Boolean).join(" ")
  )
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z\s]/g, "")
    .replace(/\s+/g, " ");
  let identityHash: string | null = null;
  let finalStatus = nextStatus;
  let failureCode: string | null = null;
  let failureMessage: string | null = null;
  if (nextStatus === "passed" && dob && docName) {
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(`${docName}|${dob}`),
    );
    identityHash = Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    const { data: dupes } = await supabase
      .from("identity_verifications")
      .select("user_id")
      .eq("identity_hash", identityHash)
      .eq("status", "passed")
      .neq("user_id", referenceId)
      .limit(1);
    if (dupes && dupes.length > 0) {
      console.warn(
        `[didit-webhook] duplicate identity: session ${sessionId} matches an already-verified account — routing to review`,
      );
      finalStatus = "review";
      failureCode = "duplicate_identity";
      failureMessage =
        "This ID is already verified on another DVNT account. One account per person.";
    }
  }

  const { error: rpcErr } = await supabase.rpc("upsert_identity_verification", {
    p_user_id: referenceId,
    p_provider: "didit",
    p_provider_ref: sessionId,
    p_status: finalStatus,
    p_doc_country: country,
    p_date_of_birth: dob,
    p_failure_code: failureCode,
    p_failure_message: failureMessage,
    p_event_created_at: new Date(eventTs * 1000).toISOString(),
  });

  if (!rpcErr && identityHash) {
    await supabase
      .from("identity_verifications")
      .update({ identity_hash: identityHash })
      .eq("user_id", referenceId);
  }

  if (rpcErr) {
    console.error("[didit-webhook] upsert error", rpcErr);
    return new Response("Server error", { status: 500 });
  }

  return new Response("ok", { status: 200 });
});
