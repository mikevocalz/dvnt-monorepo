/**
 * Payouts Release Cron Edge Function
 *
 * Runs hourly (or triggered manually).
 * Finds events where now >= payout_release_at AND payout_status='pending'.
 * Computes financials, creates Stripe payout/transfer, sends statement email.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  sendResendEmail,
  payoutStatement,
} from "../_shared/send-resend-email.ts";

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY") || "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || "";
const RESEND_FROM =
  Deno.env.get("RESEND_FROM_EMAIL") || "DVNT <noreply@dvntapp.live>";

if (!STRIPE_SECRET_KEY) {
  console.error(
    "[payouts-release] FATAL: STRIPE_SECRET_KEY env var is not set. Cron will refuse to run.",
  );
}

async function stripeRequest(
  endpoint: string,
  body: Record<string, string>,
): Promise<any> {
  const res = await fetch(`https://api.stripe.com/v1${endpoint}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(body).toString(),
  });
  return res.json();
}

const CRON_SECRET = Deno.env.get("CRON_SECRET") || "";

Deno.serve(async (req: Request) => {
  // ── Auth: require cron secret header ────────────────────
  if (CRON_SECRET) {
    const provided = req.headers.get("x-cron-secret") || "";
    if (provided !== CRON_SECRET) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }
  } else {
    console.error("[payouts-release] CRON_SECRET not set — rejecting request");
    return new Response(JSON.stringify({ error: "Misconfigured" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!STRIPE_SECRET_KEY) {
    return new Response(
      JSON.stringify({
        error: "Stripe is not configured. Payouts cannot be released.",
      }),
      {
        status: 503,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` } },
  });
  const now = new Date().toISOString();
  const results: any[] = [];

  try {
    // Find events ready for payout
    const { data: events, error } = await supabase
      .from("events")
      .select("id, title, host_id, payout_release_at, end_date")
      .eq("payout_status", "pending")
      .not("payout_release_at", "is", null)
      .lte("payout_release_at", now)
      .limit(20);

    if (error) throw error;
    if (!events?.length) {
      return new Response(
        JSON.stringify({ message: "No payouts due", processed: 0 }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    for (const event of events) {
      try {
        // ── Atomic CAS: claim this event for payout ──────────
        const { data: claimed, error: claimError } = await supabase
          .from("events")
          .update({ payout_status: "processing" })
          .eq("id", event.id)
          .eq("payout_status", "pending")
          .select("id")
          .single();

        if (claimError || !claimed) {
          results.push({
            event_id: event.id,
            status: "skipped",
            reason: "already_claimed",
          });
          continue;
        }

        // Check for active disputes on orders for this event
        const { data: disputedOrders } = await supabase
          .from("orders")
          .select("id")
          .eq("event_id", event.id)
          .eq("status", "disputed")
          .limit(1);

        if (disputedOrders?.length) {
          await supabase
            .from("events")
            .update({ payout_status: "on_hold" })
            .eq("id", event.id);
          results.push({
            event_id: event.id,
            status: "on_hold",
            reason: "dispute",
          });
          continue;
        }

        // Compute financials
        const { data: tickets } = await supabase
          .from("tickets")
          .select("purchase_amount_cents, status")
          .eq("event_id", event.id);

        const allTickets = tickets || [];
        const activeTickets = allTickets.filter(
          (t: any) => t.status !== "refunded",
        );
        const refundedTickets = allTickets.filter(
          (t: any) => t.status === "refunded",
        );

        const grossCents = activeTickets.reduce(
          (sum: number, t: any) => sum + (t.purchase_amount_cents || 0),
          0,
        );
        const refundsCents = refundedTickets.reduce(
          (sum: number, t: any) => sum + (t.purchase_amount_cents || 0),
          0,
        );

        // ── Fee structure ──────────────────────────────────────────
        // Customer: 2.5% + $1/ticket  |  Organizer: 2.5% + $1/ticket
        // DVNT total: 5% + $2/ticket (covers Stripe processing + platform fee)
        const ticketCount = activeTickets.length;
        const organizerFeeCents =
          Math.round(grossCents * 0.025) + 100 * ticketCount; // 2.5% + $1/ticket
        const dvntFeeCents = organizerFeeCents; // organizer's share of DVNT fee
        const stripeFeeCents = 0; // absorbed by the $2/ticket total
        const netCents = Math.max(
          0,
          grossCents - organizerFeeCents - refundsCents,
        );

        // Upsert financials
        await supabase.from("event_financials").upsert({
          event_id: event.id,
          gross_cents: grossCents,
          refunds_cents: refundsCents,
          dvnt_fee_cents: dvntFeeCents,
          stripe_fee_cents: stripeFeeCents,
          net_cents: netCents,
          calculated_at: now,
        });

        if (netCents <= 0) {
          await supabase
            .from("events")
            .update({ payout_status: "released" })
            .eq("id", event.id);
          results.push({
            event_id: event.id,
            status: "released",
            net_cents: 0,
          });
          continue;
        }

        // Get organizer's Stripe account
        const { data: organizer } = await supabase
          .from("organizer_accounts")
          .select("stripe_account_id, payouts_enabled")
          .eq("host_id", event.host_id)
          .single();

        if (!organizer?.stripe_account_id || !organizer?.payouts_enabled) {
          await supabase
            .from("events")
            .update({ payout_status: "on_hold" })
            .eq("id", event.id);
          results.push({
            event_id: event.id,
            status: "on_hold",
            reason: "no_stripe_account",
          });
          continue;
        }

        // Create Stripe transfer to connected account
        const transfer = await stripeRequest("/transfers", {
          amount: netCents.toString(),
          currency: "usd",
          destination: organizer.stripe_account_id,
          "metadata[event_id]": event.id.toString(),
          "metadata[type]": "event_payout",
        });

        if (transfer.error) {
          console.error("[payouts] Stripe transfer error:", transfer.error);
          await supabase
            .from("events")
            .update({ payout_status: "on_hold" })
            .eq("id", event.id);
          results.push({
            event_id: event.id,
            status: "on_hold",
            reason: transfer.error.message,
          });
          continue;
        }

        // Record payout
        await supabase.from("payouts").insert({
          event_id: event.id,
          host_id: event.host_id,
          stripe_payout_id: transfer.id,
          status: "paid",
          gross_cents: grossCents,
          net_cents: netCents,
          release_at: event.payout_release_at,
        });

        // Mark event payout as released
        await supabase
          .from("events")
          .update({ payout_status: "released" })
          .eq("id", event.id);

        // Send payout statement email
        if (RESEND_API_KEY) {
          try {
            // Fetch host email
            const { data: hostUser } = await supabase
              .from("users")
              .select("email, username")
              .eq("auth_id", event.host_id)
              .single();

            if (hostUser?.email) {
              await sendResendEmail({
                to: hostUser.email,
                from: RESEND_FROM,
                ...payoutStatement({
                  eventTitle: event.title,
                  ticketsSold: ticketCount,
                  ticketsRefunded: refundedTickets.length,
                  grossCents,
                  refundsCents,
                  feeCents: organizerFeeCents,
                  netCents,
                  releaseDate: new Date(
                    event.payout_release_at,
                  ).toLocaleDateString(),
                }),
              });
            }
          } catch (emailErr) {
            console.error("[payouts] Email error:", emailErr);
          }
        }

        results.push({
          event_id: event.id,
          status: "released",
          net_cents: netCents,
        });
      } catch (eventErr: any) {
        console.error(
          `[payouts] Error processing event ${event.id}:`,
          eventErr,
        );
        results.push({
          event_id: event.id,
          status: "error",
          error: eventErr.message,
        });
      }
    }

    return new Response(
      JSON.stringify({ processed: results.length, results }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (err: any) {
    console.error("[payouts-release] Error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
