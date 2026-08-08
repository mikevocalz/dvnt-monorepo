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
  idempotencyKey?: string,
): Promise<any> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
    "Content-Type": "application/x-www-form-urlencoded",
  };
  // Deterministic key per (event, promoter, window) / (event, window) so a
  // cron re-run — or a mid-run crash — never issues a second transfer.
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
  const res = await fetch(`https://api.stripe.com/v1${endpoint}`, {
    method: "POST",
    headers,
    body: new URLSearchParams(body).toString(),
  });
  return res.json();
}

type PromoterSettlement = {
  paidCents: number; // successfully transferred to promoter accounts
  heldCents: number; // owed but held (no account / transfer failed)
  totalCutCents: number; // paid + held — never the organizer's money
  transfers: Array<{
    promoterId: string;
    displayName: string;
    netCents: number;
    status: "paid" | "held";
    reason?: string;
    stripeTransferId?: string;
  }>;
};

/**
 * Net each promoter's unreversed earnings out of the organizer's payout
 * for one event's payout window, and disburse them to the promoter's own
 * connected account.
 *
 * - Sums unsettled promoter_ledger_entries (earning − reversal) per promoter.
 * - Resolves each promoter's Stripe account (event_promoters.stripe_account_id,
 *   else the promoter's organizer_accounts row when they are also an organizer).
 * - No account (or a failed transfer) ⇒ the share is HELD, never dropped:
 *   the earning rows keep paid_out_at IS NULL + payout_status='held' + a note,
 *   so a later run settles them once the promoter connects.
 * - Idempotent: stamped rows (paid_out_at IS NOT NULL) are skipped, and the
 *   Stripe transfer uses a deterministic Idempotency-Key.
 *
 * The organizer never earned the promoter's cut (see the LEDGER BASE note in
 * stripe-webhook), so `totalCutCents` (paid + held) reduces the organizer
 * transfer regardless of whether each promoter transfer landed.
 */
async function settlePromoters(
  supabase: any,
  eventId: number,
  windowKey: string,
): Promise<PromoterSettlement> {
  const result: PromoterSettlement = {
    paidCents: 0,
    heldCents: 0,
    totalCutCents: 0,
    transfers: [],
  };

  // Unsettled ledger rows for this event, with the promoter's account.
  const { data: rows, error } = await supabase
    .from("promoter_ledger_entries")
    .select(
      "id, promoter_id, entry_type, amount_cents, event_promoters(id, display_name, user_id, stripe_account_id, payouts_enabled)",
    )
    .eq("event_id", eventId)
    .is("paid_out_at", null);

  if (error) {
    console.error("[payouts] promoter ledger read error:", error);
    return result;
  }
  if (!rows?.length) return result;

  // Group signed amounts by promoter.
  const byPromoter = new Map<
    string,
    { net: number; promoter: any }
  >();
  for (const r of rows) {
    const pid = r.promoter_id as string;
    const cur = byPromoter.get(pid) || {
      net: 0,
      promoter: r.event_promoters,
    };
    cur.net += r.amount_cents || 0;
    byPromoter.set(pid, cur);
  }

  const nowIso = new Date().toISOString();

  for (const [promoterId, { net, promoter }] of byPromoter) {
    // Fully-reversed (net ≤ 0) → settle the paired rows to nil, no transfer.
    if (net <= 0) {
      await supabase
        .from("promoter_ledger_entries")
        .update({ paid_out_at: nowIso, payout_status: "paid" })
        .eq("event_id", eventId)
        .eq("promoter_id", promoterId)
        .is("paid_out_at", null);
      continue;
    }

    result.totalCutCents += net;
    const displayName = promoter?.display_name || "Promoter";

    // Resolve the promoter's connected account.
    let stripeAccountId: string | null =
      promoter?.stripe_account_id && promoter?.payouts_enabled
        ? promoter.stripe_account_id
        : null;
    if (!stripeAccountId && promoter?.user_id) {
      const { data: org } = await supabase
        .from("organizer_accounts")
        .select("stripe_account_id, payouts_enabled")
        .eq("host_id", promoter.user_id)
        .maybeSingle();
      if (org?.stripe_account_id && org?.payouts_enabled) {
        stripeAccountId = org.stripe_account_id;
      }
    }

    const holdShare = async (note: string) => {
      await supabase
        .from("promoter_ledger_entries")
        .update({ payout_status: "held", payout_note: note })
        .eq("event_id", eventId)
        .eq("promoter_id", promoterId)
        .is("paid_out_at", null);
      result.heldCents += net;
      result.transfers.push({
        promoterId,
        displayName,
        netCents: net,
        status: "held",
        reason: note,
      });
    };

    if (!stripeAccountId) {
      await holdShare(
        "No connected Stripe account — promoter share held until they connect.",
      );
      continue;
    }

    const transfer = await stripeRequest(
      "/transfers",
      {
        amount: net.toString(),
        currency: "usd",
        destination: stripeAccountId,
        "metadata[event_id]": eventId.toString(),
        "metadata[promoter_id]": promoterId,
        "metadata[type]": "promoter_payout",
      },
      `promoter_payout:${eventId}:${promoterId}:${windowKey}`,
    );

    if (transfer.error) {
      console.error("[payouts] promoter transfer error:", transfer.error);
      await holdShare(
        `Transfer failed: ${transfer.error.message || "unknown error"}`,
      );
      continue;
    }

    // Stamp the settled rows. Earnings carry the payout transfer id;
    // reversal rows keep their own (reversal) transfer id.
    await supabase
      .from("promoter_ledger_entries")
      .update({
        paid_out_at: nowIso,
        payout_status: "paid",
        stripe_transfer_id: transfer.id,
      })
      .eq("event_id", eventId)
      .eq("promoter_id", promoterId)
      .eq("entry_type", "earning")
      .is("paid_out_at", null);
    await supabase
      .from("promoter_ledger_entries")
      .update({ paid_out_at: nowIso, payout_status: "paid" })
      .eq("event_id", eventId)
      .eq("promoter_id", promoterId)
      .eq("entry_type", "reversal")
      .is("paid_out_at", null);

    result.paidCents += net;
    result.transfers.push({
      promoterId,
      displayName,
      netCents: net,
      status: "paid",
      stripeTransferId: transfer.id,
    });
  }

  return result;
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

        // ── Split ledger: net promoter cuts out of the organizer's take ──
        // Runs before the organizer transfer so their share is disbursed to
        // their own connected accounts (or held) and never lands in the
        // organizer's payout. Idempotent + deterministic per payout window.
        const windowKey =
          event.payout_release_at || event.end_date || String(event.id);
        const settlement = await settlePromoters(
          supabase,
          event.id,
          windowKey,
        );
        const organizerNetCents = Math.max(
          0,
          netCents - settlement.totalCutCents,
        );

        if (organizerNetCents <= 0) {
          // Promoters may have been paid above; organizer has nothing left.
          await supabase
            .from("events")
            .update({ payout_status: "released" })
            .eq("id", event.id);
          results.push({
            event_id: event.id,
            status: "released",
            net_cents: 0,
            promoter_paid_cents: settlement.paidCents,
            promoter_held_cents: settlement.heldCents,
            promoter_transfers: settlement.transfers,
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

        // Create Stripe transfer to connected account (organizer's net,
        // already reduced by the promoter cut above).
        const transfer = await stripeRequest(
          "/transfers",
          {
            amount: organizerNetCents.toString(),
            currency: "usd",
            destination: organizer.stripe_account_id,
            "metadata[event_id]": event.id.toString(),
            "metadata[type]": "event_payout",
          },
          `event_payout:${event.id}:${windowKey}`,
        );

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

        // Record payout (organizer's net, after promoter split)
        await supabase.from("payouts").insert({
          event_id: event.id,
          host_id: event.host_id,
          stripe_payout_id: transfer.id,
          status: "paid",
          gross_cents: grossCents,
          net_cents: organizerNetCents,
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
                  feeCents: organizerFeeCents + settlement.totalCutCents,
                  netCents: organizerNetCents,
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
          net_cents: organizerNetCents,
          promoter_paid_cents: settlement.paidCents,
          promoter_held_cents: settlement.heldCents,
          promoter_transfers: settlement.transfers,
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
