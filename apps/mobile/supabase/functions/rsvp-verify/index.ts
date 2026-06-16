/**
 * Edge Function: rsvp-verify
 *
 * OTP gate for GUEST free-RSVP (Phase 5.6.3b). No account required — the OTP
 * is the minimum proof-of-human: it confirms the contact can receive the ticket
 * AND throttles bot RSVP-flooding. We never store the code, only sha256(code).
 *
 *   POST { action: "issue",  event_id, channel: "email", destination }
 *        -> emails a 6-digit code (rate-limited per destination). { ok }
 *   POST { action: "verify", event_id, channel: "email", destination, code }
 *        -> on success returns a short-lived HMAC grant the issuer trusts.
 *           { ok, grant }
 *
 * The grant (HMAC over {event_id,destination,exp}, TICKET_HMAC_SECRET) is what
 * rsvp-issue-ticket validates to issue the free ticket(s) — so issuance can't be
 * driven without a verified contact.
 *
 * Deno env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY,
 *           RESEND_FROM_EMAIL, TICKET_HMAC_SECRET.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  sendResendEmail,
  verificationCode,
} from "../_shared/send-resend-email.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const OTP_TTL_MIN = 10;
const ISSUE_WINDOW_MIN = 10; // rate-limit window
const ISSUE_MAX_PER_WINDOW = 5; // codes per destination per window
const GRANT_TTL_MS = 15 * 60 * 1000;
const GRANT_SECRET =
  Deno.env.get("TICKET_HMAC_SECRET") || "dvnt-ticket-hmac-default-key";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
function err(code: string, message: string, status = 200): Response {
  return json({ ok: false, error: { code, message } }, status);
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function b64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
async function sha256hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function hmac(data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(GRANT_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return b64url(new Uint8Array(sig));
}
async function makeGrant(payload: Record<string, unknown>): Promise<string> {
  const body = b64url(new TextEncoder().encode(JSON.stringify(payload)));
  return `${body}.${await hmac(body)}`;
}
// Constant-time hex compare.
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } },
    );
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "");
    const eventId = Number(body.event_id);
    const channel = String(body.channel || "email");
    const destination = String(body.destination || "").trim().toLowerCase();

    if (channel !== "email") return err("unsupported_channel", "Only email is supported.");
    if (!EMAIL_RE.test(destination)) return err("invalid_destination", "Enter a valid email.");
    if (!Number.isFinite(eventId)) return err("invalid_event", "Missing event.");

    // The event must be a public, free-RSVP event (paid events use checkout).
    const { data: ev, error: evErr } = await supabase
      .from("events")
      .select("ticketing_enabled, status, visibility")
      .eq("id", eventId)
      .single();
    if (evErr || !ev) return err("event_not_found", "Event not found.", 404);
    if (ev.visibility !== "public") return err("event_not_found", "Event not found.", 404);
    if (ev.ticketing_enabled) return err("requires_checkout", "This event requires a paid ticket.");

    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;

    if (action === "issue") {
      // Rate limit: count issuances to this destination in the window.
      const since = new Date(Date.now() - ISSUE_WINDOW_MIN * 60_000).toISOString();
      const { count } = await supabase
        .from("rsvp_otp_codes")
        .select("id", { count: "exact", head: true })
        .eq("destination", destination)
        .gte("created_at", since);
      if ((count ?? 0) >= ISSUE_MAX_PER_WINDOW)
        return err("rate_limited", "Too many codes requested. Try again shortly.", 429);

      const code = String(Math.floor(100000 + Math.random() * 900000));
      const code_hash = await sha256hex(code);

      // Invalidate any prior live code for this destination+event (re-issue).
      await supabase
        .from("rsvp_otp_codes")
        .update({ consumed_at: new Date().toISOString() })
        .eq("destination", destination)
        .eq("event_id", eventId)
        .is("consumed_at", null);

      const { error: insErr } = await supabase.from("rsvp_otp_codes").insert({
        event_id: eventId,
        channel,
        destination,
        code_hash,
        expires_at: new Date(Date.now() + OTP_TTL_MIN * 60_000).toISOString(),
        request_ip: ip,
      });
      if (insErr) return err("internal_error", "Could not issue a code.", 500);

      await sendResendEmail({
        to: destination,
        ...verificationCode(code, { expiryMin: OTP_TTL_MIN }),
      });
      return json({ ok: true });
    }

    if (action === "verify") {
      const code = String(body.code || "").trim();
      if (!/^\d{6}$/.test(code)) return err("invalid_code", "Enter the 6-digit code.");

      const { data: row } = await supabase
        .from("rsvp_otp_codes")
        .select("id, code_hash, attempts, max_attempts, expires_at")
        .eq("destination", destination)
        .eq("event_id", eventId)
        .is("consumed_at", null)
        .gt("expires_at", new Date().toISOString())
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!row) return err("code_expired", "Code expired or not found. Request a new one.");

      if (row.attempts >= row.max_attempts) {
        await supabase
          .from("rsvp_otp_codes")
          .update({ consumed_at: new Date().toISOString() })
          .eq("id", row.id);
        return err("too_many_attempts", "Too many attempts. Request a new code.", 429);
      }
      await supabase
        .from("rsvp_otp_codes")
        .update({ attempts: row.attempts + 1 })
        .eq("id", row.id);

      const ok = timingSafeEqual(await sha256hex(code), row.code_hash);
      if (!ok) return err("invalid_code", "Incorrect code.");

      await supabase
        .from("rsvp_otp_codes")
        .update({ consumed_at: new Date().toISOString() })
        .eq("id", row.id);

      const grant = await makeGrant({
        event_id: eventId,
        destination,
        channel,
        exp: Date.now() + GRANT_TTL_MS,
      });
      return json({ ok: true, grant, destination });
    }

    return err("invalid_action", "Unknown action.");
  } catch (e) {
    console.error("[rsvp-verify]", e);
    return err("internal_error", "Unexpected server error.", 500);
  }
});
