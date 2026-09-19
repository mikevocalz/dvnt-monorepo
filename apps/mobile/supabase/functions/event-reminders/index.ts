/**
 * Edge Function: event-reminders
 *
 * Cron sweep (every 15 min via cron_event_reminder_sweep → x-cron-secret).
 * Three hours before an event starts, every ticket holder gets ONE
 * reminder email: flyer, event details, and their ticket(s) — the same
 * ticketConfirmation layout as the purchase email, so the reminder
 * doubles as "the email with my QR in it" at the door.
 *
 * Per event: all sends must succeed before `events.reminder_sent_at` is
 * stamped, so a Resend outage retries the whole event on the next sweep
 * rather than silently skipping the people it failed on.
 *
 * Auth: header `x-cron-secret: <CRON_SECRET>` (Vault-backed dispatcher,
 * same pattern as cron_reconcile_orders).
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  sendResendEmail,
  ticketConfirmation,
} from "../_shared/send-resend-email.ts";

const CRON_SECRET = Deno.env.get("CRON_SECRET") || "";
const SITE_URL =
  (Deno.env.get("PUBLIC_SITE_URL") || "https://dvntapp.live").replace(/\/$/, "");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

function fmtDateLine(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return null;
  return d.toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS")
    return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  if (!CRON_SECRET) {
    console.error("[event-reminders] CRON_SECRET not set — rejecting request");
    return json({ error: "misconfigured" }, 500);
  }
  if ((req.headers.get("x-cron-secret") || "") !== CRON_SECRET) {
    return json({ error: "unauthorized" }, 401);
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  const now = Date.now();
  // Events starting in a 60-min band centred on now+3h. The sweep runs
  // every 15 min, so every event crosses the band exactly once.
  const windowStart = new Date(now + 150 * 60_000).toISOString();
  const windowEnd = new Date(now + 210 * 60_000).toISOString();

  const { data: events, error: evErr } = await supabase
    .from("events")
    .select(
      "id, title, start_date, date, location, location_name, location_address, " +
        "flyer_image_url, dominant_color, status, reminder_sent_at",
    )
    .gte("start_date", windowStart)
    .lt("start_date", windowEnd)
    .is("reminder_sent_at", null);
  if (evErr) {
    console.error("[event-reminders] event query failed:", evErr);
    return json({ error: "event query failed" }, 500);
  }

  let sent = 0;
  let failed = 0;
  const processed: number[] = [];

  for (const ev of events ?? []) {
    if (String(ev.status) === "cancelled") continue;
    try {
      const { data: rows, error: tErr } = await supabase
        .from("tickets")
        .select(
          "id, user_id, guest_email, guest_name, attendee_name, qr_token, " +
            "guest_lookup_token, status, ticket_type:ticket_types(name, category)",
        )
        .eq("event_id", ev.id)
        .not("status", "in", "(refunded,void,transfer_pending)");
      if (tErr) throw tErr;

      // Resolve account-holder emails (tickets.user_id is the Better Auth id).
      const authIds = [
        ...new Set(
          (rows ?? [])
            .filter((t: any) => !t.guest_email && t.user_id)
            .map((t: any) => String(t.user_id)),
        ),
      ];
      const emailByAuthId = new Map<string, string>();
      if (authIds.length > 0) {
        const { data: userRows } = await supabase
          .from("user")
          .select("id, email")
          .in("id", authIds);
        for (const u of userRows ?? []) {
          if (u.email) emailByAuthId.set(String(u.id), String(u.email));
        }
      }

      // Group every deliverable ticket by recipient — one email per inbox.
      const byRecipient = new Map<string, any[]>();
      for (const t of rows ?? []) {
        const to = t.guest_email ||
          (t.user_id ? emailByAuthId.get(String(t.user_id)) : null);
        if (!to) continue;
        const list = byRecipient.get(to) ?? [];
        list.push(t);
        byRecipient.set(to, list);
      }

      let eventFailed = 0;
      for (const [to, tickets] of byRecipient) {
        const isAccountTicket = tickets.some(
          (t) => !t.guest_email && t.user_id,
        );
        const multi = tickets.length > 1;
        try {
          await sendResendEmail({
            to,
            ...ticketConfirmation({
              eventTitle: ev.title || "your event",
              flyerUrl: ev.flyer_image_url ?? null,
              dominantColor: ev.dominant_color ?? null,
              dateLine: fmtDateLine(ev.start_date ?? ev.date),
              location: ev.location_name || ev.location || ev.location_address ||
                null,
              subject: `${ev.title || "Your event"} — starts in 3 hours`,
              heading: "It's almost time.",
              preheader:
                `${ev.title || "Your event"} starts soon — your ticket${multi ? "s are" : " is"} inside.`,
              greeting:
                `${ev.title || "Your event"} starts in about 3 hours. Your ticket${
                  multi ? "s are" : " is"
                } below — have the QR ready when you get to the door.`,
              toEmail: to,
              manageUrl: isAccountTicket ? `${SITE_URL}/my-tickets` : null,
              claimUrl: isAccountTicket ? null : undefined,
              calendar: ev.start_date
                ? { startIso: ev.start_date }
                : null,
              summary: [{
                label: "Tickets",
                value: String(tickets.length),
              }],
              tickets: tickets.map((t: any) => {
                const tt = Array.isArray(t.ticket_type)
                  ? t.ticket_type[0]
                  : t.ticket_type;
                return {
                  tier: tt?.category ?? "ga",
                  tierLabel: tt?.name ?? null,
                  qrToken: t.qr_token ?? null,
                  lookupUrl: t.guest_lookup_token
                    ? `${SITE_URL}/public/tickets/guest/${t.guest_lookup_token}`
                    : null,
                  note: t.attendee_name
                    ? `Ticket for ${t.attendee_name}`
                    : null,
                };
              }),
            }),
          });
          sent++;
        } catch (sendErr) {
          eventFailed++;
          failed++;
          console.error(
            `[event-reminders] send failed for event ${ev.id}:`,
            sendErr,
          );
        }
      }

      // Only stamp the event when every recipient got their mail — a
      // partial send retries on the next sweep instead of being lost.
      if (eventFailed === 0) {
        await supabase
          .from("events")
          .update({ reminder_sent_at: new Date().toISOString() })
          .eq("id", ev.id)
          .is("reminder_sent_at", null);
        processed.push(ev.id);
      }
    } catch (err) {
      failed++;
      console.error(`[event-reminders] event ${ev.id} failed:`, err);
    }
  }

  return json({
    ok: true,
    events_seen: (events ?? []).length,
    events_completed: processed,
    emails_sent: sent,
    emails_failed: failed,
  });
});
