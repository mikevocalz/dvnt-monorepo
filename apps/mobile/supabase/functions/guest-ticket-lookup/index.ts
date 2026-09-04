/**
 * Edge Function: guest-ticket-lookup
 *
 * Guest re-request by email (WS-7): a guest who lost their ticket email
 * asks for it again. Finds unclaimed guest tickets (tickets.user_id IS NULL,
 * verified-at-purchase guest_email match) and RE-SENDS the ticket email(s)
 * to that address — one email per event, same template as original delivery,
 * now with claim CTA + calendar links.
 *
 *   POST { email, event_id? }
 *   -> { ok: true, message } — ALWAYS identical, whether or not tickets
 *      exist. Ticket data is never returned in the response; delivery is
 *      email-only, so possession of the inbox stays the authorization
 *      boundary and the endpoint cannot be used to enumerate guest emails.
 *
 * Rate-limited per email and per IP (../_shared/rate-limit.ts). The send
 * work runs after the response (EdgeRuntime.waitUntil) so response timing
 * doesn't leak whether tickets were found.
 *
 * Deno env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY,
 *           RESEND_FROM_EMAIL, PUBLIC_SITE_URL.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  sendResendEmail,
  ticketConfirmation,
} from "../_shared/send-resend-email.ts";
import { checkRateLimit } from "../_shared/rate-limit.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, sentry-trace, baggage",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SITE_URL = (
  Deno.env.get("PUBLIC_SITE_URL") || "https://dvntapp.live"
).replace(/\/$/, "");

/** Uniform response — identical for hit and miss (anti-enumeration). */
function uniformOk(): Response {
  return new Response(
    JSON.stringify({
      ok: true,
      message:
        "If guest tickets exist for that email, we've re-sent them. Check your inbox and spam folder.",
    }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
}

function err(code: string, message: string, status = 400): Response {
  return new Response(
    JSON.stringify({ ok: false, error: { code, message } }),
    { status, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
}

function fmtDateLine(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

interface TicketRow {
  id: string | number;
  event_id: string | number;
  status: string;
  qr_token: string | null;
  guest_lookup_token: string | null;
  guest_name: string | null;
  ticket_type: { name: string | null } | { name: string | null }[] | null;
  event:
    | {
        title: string | null;
        start_date: string | null;
        end_date: string | null;
        location: string | null;
        location_name: string | null;
        flyer_image_url: string | null;
        cover_image_url: string | null;
        dominant_color: string | null;
      }
    | null;
}

async function findAndResend(email: string, eventId: string | null) {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  // ilike with wildcards escaped = case-insensitive equality ("_" and "%"
  // are legal in email local parts and MUST NOT act as LIKE wildcards).
  const likeSafe = email.replace(/[\\%_]/g, "\\$&");

  let query = supabase
    .from("tickets")
    .select(
      `
      id,
      event_id,
      status,
      qr_token,
      guest_lookup_token,
      guest_name,
      ticket_type:ticket_types(name),
      event:events(title, start_date, end_date, location, location_name, flyer_image_url, cover_image_url, dominant_color)
    `,
    )
    .is("user_id", null)
    .eq("status", "active")
    .ilike("guest_email", likeSafe)
    .limit(50);
  if (eventId) query = query.eq("event_id", eventId);

  const { data, error } = await query;
  if (error) {
    console.error("[guest-ticket-lookup] query error:", error.message);
    return;
  }
  const rows = (data ?? []) as unknown as TicketRow[];
  if (!rows.length) return;

  // Group per event; skip events that ended more than a day ago.
  const cutoff = Date.now() - 24 * 3600_000;
  const byEvent = new Map<string, TicketRow[]>();
  for (const row of rows) {
    const ev = Array.isArray(row.event) ? row.event[0] : row.event;
    const endRef = ev?.end_date || ev?.start_date;
    if (endRef) {
      const t = new Date(endRef).getTime();
      if (!isNaN(t) && t < cutoff) continue;
    }
    const key = String(row.event_id);
    const list = byEvent.get(key) ?? [];
    list.push(row);
    byEvent.set(key, list);
  }

  // Bound the work: at most 5 event emails, 10 tickets each.
  let sentEvents = 0;
  for (const [, tickets] of byEvent) {
    if (sentEvents >= 5) break;
    const first = tickets[0];
    const ev = Array.isArray(first.event) ? first.event[0] : first.event;
    if (!ev) continue;

    const startIso = ev.start_date ?? null;
    const guestName = first.guest_name;
    const lines = tickets.slice(0, 10).map((t) => {
      const tierRow = Array.isArray(t.ticket_type)
        ? t.ticket_type[0]
        : t.ticket_type;
      return {
        tier: null,
        tierLabel: tierRow?.name ?? null,
        qrToken: t.qr_token,
        lookupUrl: t.guest_lookup_token
          ? `${SITE_URL}/public/tickets/guest/${t.guest_lookup_token}`
          : null,
        note: t.guest_name,
      };
    });

    try {
      await sendResendEmail({
        to: email,
        ...ticketConfirmation({
          eventTitle: ev.title ?? "your event",
          dateLine: fmtDateLine(startIso),
          location: ev.location_name ?? ev.location ?? null,
          flyerUrl: ev.flyer_image_url ?? ev.cover_image_url ?? null,
          dominantColor: ev.dominant_color ?? null,
          toEmail: email,
          guestNudge: true,
          calendar: startIso
            ? { startIso, endIso: ev.end_date ?? null }
            : null,
          greeting: `${guestName ? `Hey ${guestName}, ` : ""}here ${
            lines.length > 1 ? "are your tickets" : "is your ticket"
          } again — same QR${lines.length > 1 ? "s" : ""} as before, still valid at the door.`,
          tickets: lines,
        }),
      });
      sentEvents++;
      console.log(
        `[guest-ticket-lookup] re-sent ${lines.length} ticket(s) for event ${first.event_id}`,
      );
    } catch (e) {
      console.error("[guest-ticket-lookup] send failed:", e);
    }
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") return err("method_not_allowed", "Method not allowed", 405);

  try {
    const body = await req.json().catch(() => ({}));
    const email = String(body.email ?? "").trim().toLowerCase();
    const eventId =
      body.event_id != null && String(body.event_id).trim() !== ""
        ? String(body.event_id).trim()
        : null;

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
      return err("invalid_email", "A valid email address is required.");
    }

    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    const ipRl = checkRateLimit(ip, "guest-ticket-lookup-ip", {
      maxRequests: 10,
      windowMs: 60_000,
    });
    const emailRl = checkRateLimit(email, "guest-ticket-lookup", {
      maxRequests: 3,
      windowMs: 10 * 60_000,
    });
    if (!ipRl.allowed || !emailRl.allowed) {
      return err("rate_limited", "Too many requests. Try again in a few minutes.", 429);
    }

    // Respond BEFORE the lookup/send so response timing can't distinguish
    // "found tickets" from "found nothing".
    const work = findAndResend(email, eventId).catch((e) =>
      console.error("[guest-ticket-lookup] background work failed:", e),
    );
    const runtime = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } })
      .EdgeRuntime;
    if (runtime?.waitUntil) {
      runtime.waitUntil(work);
    } else {
      await work;
    }

    return uniformOk();
  } catch (e) {
    console.error("[guest-ticket-lookup]", e);
    return err("internal_error", "Unexpected server error.", 500);
  }
});
