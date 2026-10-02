/**
 * ticket-sms-webhook — Twilio inbound keyword + delivery receipt endpoint.
 *
 * verify_jwt = false in config.toml, because Twilio cannot present a Supabase
 * session JWT. The X-Twilio-Signature check below is the authentication, so it
 * runs to completion BEFORE any database write and fails closed: no auth token
 * configured, no signature header, or a signature that does not match means a
 * 403 and nothing touched.
 *
 * Without it, anyone who knew a phone number could POST
 * `From=+1XXXXXXXXXX&Body=START` and flip that number's opt-out back to
 * sendable, or forge `MessageStatus=delivered` for a message that never
 * arrived.
 *
 * Twilio's scheme (same shape as the Stripe HMAC in stripe-webhook/index.ts):
 * HMAC-SHA1 over the request URL followed by every POST parameter sorted by
 * key and concatenated as key+value, base64-encoded, keyed with
 * TWILIO_AUTH_TOKEN.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const TWILIO_AUTH_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN") || "";
// Optional. Set it to the exact URL configured in the Twilio console when the
// gateway rewrites host or scheme in a way the forwarded headers do not capture.
const TWILIO_WEBHOOK_URL = Deno.env.get("TWILIO_WEBHOOK_URL") || "";

const OPT_OUT_KEYWORDS = ["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT"];
const OPT_IN_KEYWORDS = ["START", "UNSTOP", "YES"];

/**
 * Provider fields we persist, and nothing else. The inbound `Body` is the
 * recipient's own free text and `From`/`To` are bare phone numbers; none of
 * them belong in a jsonb column, and before this list the handler stored the
 * entire form including all three.
 */
const PERSISTED_PROVIDER_FIELDS = [
  "MessageSid",
  "MessageStatus",
  "ErrorCode",
  "AccountSid",
  "NumSegments",
] as const;

function normalize(raw: string): string | null {
  const text = raw.trim();
  return /^\+[1-9]\d{7,14}$/.test(text) ? text : null;
}

/**
 * The URL Twilio signed. It signs the URL it was configured with, which is not
 * necessarily the one this process sees behind the gateway, so try the
 * server-controlled candidates in order. Every candidate comes from
 * configuration or from the request's own routing headers; none of them is
 * attacker-chosen content, so accepting a match against any of them does not
 * weaken the check.
 */
function signedUrlCandidates(req: Request): string[] {
  const requested = new URL(req.url);
  const candidates: string[] = [];
  if (TWILIO_WEBHOOK_URL) {
    candidates.push(
      TWILIO_WEBHOOK_URL.includes("?")
        ? TWILIO_WEBHOOK_URL
        : `${TWILIO_WEBHOOK_URL}${requested.search}`,
    );
  }
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host");
  if (host) {
    const proto = req.headers.get("x-forwarded-proto") ||
      requested.protocol.replace(/:$/, "");
    candidates.push(`${proto}://${host}${requested.pathname}${requested.search}`);
  }
  candidates.push(requested.toString());
  return [...new Set(candidates)];
}

async function twilioSignature(url: string, params: [string, string][]): Promise<string> {
  const data = params
    .slice()
    .sort(([ak, av], [bk, bv]) => (ak === bk ? (av < bv ? -1 : av > bv ? 1 : 0) : ak < bk ? -1 : 1))
    .reduce((acc, [k, v]) => acc + k + v, url);
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(TWILIO_AUTH_TOKEN),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const mac = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data)),
  );
  return btoa(String.fromCharCode(...mac));
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function verifyTwilioSignature(
  req: Request,
  header: string,
  params: [string, string][],
): Promise<boolean> {
  for (const url of signedUrlCandidates(req)) {
    if (timingSafeEqual(await twilioSignature(url, params), header)) return true;
  }
  return false;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  // Fail closed on a missing token. A 500 here is deliberate: Twilio retries
  // it, so a misconfigured deploy loses nothing once the token is set, whereas
  // treating "no token" as "skip the check" is the whole vulnerability.
  if (!TWILIO_AUTH_TOKEN) {
    console.error("[ticket-sms-webhook] TWILIO_AUTH_TOKEN not configured — rejecting");
    return new Response("Webhook secret not configured", { status: 500 });
  }

  const form = await req.formData().catch(() => null);
  if (!form) return new Response("Bad request", { status: 400 });

  const params: [string, string][] = [];
  for (const [k, v] of form.entries()) {
    if (typeof v === "string") params.push([k, v]);
  }

  const signature = req.headers.get("x-twilio-signature") || "";
  if (!signature) {
    console.error("[ticket-sms-webhook] missing X-Twilio-Signature — rejecting");
    return new Response("Missing signature", { status: 403 });
  }
  if (!await verifyTwilioSignature(req, signature, params)) {
    console.error("[ticket-sms-webhook] invalid X-Twilio-Signature — rejecting");
    return new Response("Invalid signature", { status: 403 });
  }

  // ── Past this line the request is authentic. Nothing above wrote. ──────
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const sid = String(form.get("MessageSid") || form.get("SmsSid") || "");
  const status = String(form.get("MessageStatus") || form.get("SmsStatus") || "").toLowerCase();
  const from = normalize(String(form.get("From") || ""));
  const body = String(form.get("Body") || "").trim().toUpperCase();

  if (from && body) {
    const keyword = body.split(/\s+/)[0];
    const optOut = OPT_OUT_KEYWORDS.includes(keyword);
    const optIn = OPT_IN_KEYWORDS.includes(keyword);
    if (optOut || optIn) {
      // apply_sms_keyword records the keyword and the resulting state in one
      // transaction, and refuses to let an opt-in overwrite a recorded
      // opt-out. The old upsert here set state unconditionally, so a forged
      // START erased a real STOP and the next comp batch texted the number
      // again.
      const { error: keywordError } = await supabase.rpc("apply_sms_keyword", {
        p_phone_e164: from,
        p_keyword: keyword,
        p_opt_out: optOut,
        p_source: "provider_keyword",
      });
      if (keywordError) {
        // 500 so Twilio redelivers. A dropped STOP is a compliance breach, not
        // a log line.
        console.error("[ticket-sms-webhook] keyword write failed:", keywordError.code);
        return new Response("Keyword not recorded", { status: 500 });
      }
    }
  }

  if (sid && status) {
    const { data: ticket, error: ticketLookupError } = await supabase
      .from("tickets")
      .select("id, guest_phone_e164")
      .eq("guest_sms_provider_id", sid)
      .maybeSingle();
    if (ticketLookupError) {
      console.error("[ticket-sms-webhook] ticket lookup failed:", ticketLookupError.code);
      return new Response("Lookup failed", { status: 500 });
    }

    if (ticket) {
      const mapped = status === "delivered"
        ? "delivered"
        : ["failed", "undelivered"].includes(status) ? "failed"
        : ["sent"].includes(status) ? "sent" : "queued";
      // ErrorCode, not ErrorMessage: a numeric provider code carries the same
      // diagnostic value and cannot smuggle free text into a stored column.
      const errorCode = String(form.get("ErrorCode") || "").slice(0, 32);
      const { error: ticketUpdateError } = await supabase.from("tickets").update({
        guest_sms_status: mapped,
        ...(mapped === "delivered" ? { guest_sms_delivered_at: new Date().toISOString() } : {}),
        ...(mapped === "failed"
          ? {
            guest_sms_last_error: errorCode
              ? `Provider delivery failure (${errorCode})`
              : "Provider delivery failure",
          }
          : {}),
      }).eq("id", ticket.id);
      if (ticketUpdateError) {
        console.error("[ticket-sms-webhook] ticket update failed:", ticketUpdateError.code);
        return new Response("Status not recorded", { status: 500 });
      }

      const providerPayload: Record<string, string> = {};
      for (const field of PERSISTED_PROVIDER_FIELDS) {
        const value = form.get(field);
        if (typeof value === "string" && value) providerPayload[field] = value.slice(0, 64);
      }

      const { error: eventError } = await supabase.from("ticket_sms_delivery_events").upsert({
        ticket_id: ticket.id,
        provider_message_id: sid,
        phone_e164: ticket.guest_phone_e164,
        status: mapped,
        retryable: false,
        error: mapped === "failed" ? (errorCode || "Provider delivery failure") : null,
        provider_payload: providerPayload,
      }, { onConflict: "provider_message_id,status" });
      if (eventError) {
        // This used to be discarded while the handler still returned 200, so
        // the 42P10 from the partial index left the delivery audit trail empty
        // and Twilio never retried. Surface it.
        console.error("[ticket-sms-webhook] delivery event write failed:", eventError.code);
        return new Response("Delivery event not recorded", { status: 500 });
      }
    }
  }
  return new Response("ok", { status: 200 });
});
