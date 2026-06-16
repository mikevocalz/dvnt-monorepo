/**
 * Edge Function: rsvp-issue-guest
 *
 * Issues free-RSVP ticket(s) to a GUEST (no account) after rsvp-verify confirmed
 * their contact. Validates the HMAC grant from rsvp-verify (so issuance can't be
 * driven without a verified email), then calls issue_guest_rsvp_tickets (capacity
 * + per-guest cap serialized in SQL) and emails the ticket links.
 *
 *   POST { grant, event_id, quantity?, guest_name?, attendee_names?[] }
 *   -> { ok, order_id, count, tickets: [{ guest_lookup_token, order_index, ... }] }
 *
 * Deno env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY,
 *           RESEND_FROM_EMAIL, TICKET_HMAC_SECRET, PUBLIC_SITE_URL.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  sendResendEmail,
  ticketConfirmation,
} from "../_shared/send-resend-email.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const GRANT_SECRET =
  Deno.env.get("TICKET_HMAC_SECRET") || "dvnt-ticket-hmac-default-key";
const SITE_URL = (Deno.env.get("PUBLIC_SITE_URL") || "https://dvntapp.live").replace(/\/$/, "");

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
function err(code: string, message: string, status = 200): Response {
  return json({ ok: false, error: { code, message } }, status);
}

function b64urlToBytes(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + pad;
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}
function bytesToB64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
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
  return bytesToB64url(new Uint8Array(sig));
}
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
async function verifyGrant(
  grant: string,
): Promise<{ event_id: number; destination: string; exp: number } | null> {
  const dot = grant.lastIndexOf(".");
  if (dot < 0) return null;
  const body = grant.slice(0, dot);
  const sig = grant.slice(dot + 1);
  if (!timingSafeEqual(await hmac(body), sig)) return null;
  try {
    const payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(body)));
    if (typeof payload?.exp !== "number" || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
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
    const eventId = Number(body.event_id);
    const quantity = Math.max(1, Math.min(10, Number(body.quantity) || 1));
    const guestName = body.guest_name ? String(body.guest_name) : null;
    const attendeeNames: string[] | null = Array.isArray(body.attendee_names)
      ? body.attendee_names.map((n: unknown) => (n == null ? "" : String(n)))
      : null;

    const grant = await verifyGrant(String(body.grant || ""));
    if (!grant) return err("invalid_grant", "Verification expired. Confirm your email again.", 401);
    if (grant.event_id !== eventId)
      return err("grant_mismatch", "Verification doesn't match this event.", 401);

    const { data, error } = await supabase.rpc("issue_guest_rsvp_tickets", {
      p_event_id: eventId,
      p_guest_email: grant.destination,
      p_guest_name: guestName,
      p_attendee_names: attendeeNames,
      p_quantity: quantity,
    });
    if (error) {
      console.error("[rsvp-issue-guest] rpc error:", error);
      return err("internal_error", "Could not issue your RSVP.", 500);
    }
    const result = typeof data === "string" ? JSON.parse(data) : data;
    if (result?.error) return err(result.error, "Couldn't RSVP: " + result.error);

    // Email the ticket(s) — one delivery, each with its own no-login view link.
    const tickets: Array<{
      guest_lookup_token: string;
      order_index: number;
      order_count: number;
      attendee_name: string | null;
    }> = result.tickets || [];
    const { data: ev } = await supabase
      .from("events")
      .select("title, date, location, flyer_image_url, dominant_color")
      .eq("id", eventId)
      .single();
    const evTitle = ev?.title ?? "your event";
    const dateLine = ev?.date
      ? new Date(ev.date).toLocaleString("en-US", {
          weekday: "short",
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        })
      : null;

    await sendResendEmail({
      to: grant.destination,
      ...ticketConfirmation({
        eventTitle: evTitle,
        flyerUrl: ev?.flyer_image_url ?? null,
        dominantColor: ev?.dominant_color ?? null,
        dateLine,
        location: ev?.location ?? null,
        toEmail: grant.destination,
        guestNudge: true,
        greeting: `Your RSVP for ${evTitle} is confirmed. Open your ticket${
          tickets.length > 1 ? "s" : ""
        } below — each has its own QR for the door.`,
        tickets: tickets.map((t) => ({
          tier: "free",
          lookupUrl: `${SITE_URL}/public/tickets/guest/${t.guest_lookup_token}`,
          note: t.attendee_name,
        })),
      }),
    });

    return json({
      ok: true,
      order_id: result.order_id,
      count: result.count,
      tickets,
    });
  } catch (e) {
    console.error("[rsvp-issue-guest]", e);
    return err("internal_error", "Unexpected server error.", 500);
  }
});
