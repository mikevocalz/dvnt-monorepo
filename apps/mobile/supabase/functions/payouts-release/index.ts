import { isConfiguredPlatformOwner } from "../_shared/owner-dispute-policy.ts";
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
import { withHeartbeat, tryClaimJob, releaseJob } from "../_shared/heartbeat.ts";
import { withSentry } from "../_shared/sentry.ts";
import { assertSafeRelease, checkedWrite } from "./safety.ts";

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
  // Deterministic key per event/promoter/window provides
  // short-lived retry deduplication. Durable event holds prevent crash replay.
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
  const res = await fetch(`https://api.stripe.com/v1${endpoint}`, {
    method: "POST",
    headers,
    body: new URLSearchParams(body).toString(),
  });
  const result = await res.json();
  if (!res.ok || result.error || typeof result.id !== "string") {
    throw new Error(`Stripe transfer failed or unconfirmed: ${result.error?.message || res.status}`);
  }
  return result;
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
 * Settle a first-attempt event's promoter ledger before the organizer share.
 * Preflight rejects prior settlement activity; partial/uncertain outcomes stay
 * held for reconciliation rather than replaying this aggregate calculation.
 * An unconnected promoter's share remains held and is still deducted.
 */
async function settlePromoters(
  supabase: any,
  eventId: number,
  windowKey: string,
  availableCents: number,
): Promise<PromoterSettlement> {
  const result: PromoterSettlement = {
    paidCents: 0,
    heldCents: 0,
    totalCutCents: 0,
    transfers: [],
  };

  // Preflight below rejects previously settled rows: retries require reconciliation.
  const { data: rows, error } = await supabase
    .from("promoter_ledger_entries")
    .select(
      "id, promoter_id, entry_type, amount_cents, event_promoters(id, display_name, user_id, stripe_account_id, payouts_enabled)",
    )
    .eq("event_id", eventId)
    .is("paid_out_at", null).limit(1001);

  if (error) {
    console.error("[payouts] promoter ledger read error:", error);
    throw error;
  }
  if (!rows || rows.length >= 1000) throw new Error("Promoter ledger requires reconciliation");
  if (!rows.length) return result;

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
    if (!Number.isSafeInteger(r.amount_cents)) throw new Error("Invalid promoter amount");
    cur.net += r.amount_cents;
    byPromoter.set(pid, cur);
  }

  const totalCut = [...byPromoter.values()].reduce((sum, row) => sum + Math.max(0, row.net), 0);
  if (!Number.isSafeInteger(availableCents) || availableCents < 0 ||
      !Number.isSafeInteger(totalCut) || totalCut > availableCents) {
    throw new Error("Invalid settlement budget; reconciliation required");
  }
  const nowIso = new Date().toISOString();

  for (const [promoterId, { net, promoter }] of byPromoter) {
    const rowIds = rows.filter((r: any) => r.promoter_id === promoterId).map((r: any) => r.id);
    // Fully-reversed (net ≤ 0) → settle the paired rows to nil, no transfer.
    if (net <= 0) {
      await checkedWrite(supabase
        .from("promoter_ledger_entries")
        .update({ paid_out_at: nowIso, payout_status: "paid" })
        .eq("event_id", eventId)
        .eq("promoter_id", promoterId)
        .in("id", rowIds)
        .is("paid_out_at", null), rowIds.length);
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
      const { data: org, error: orgError } = await supabase
        .from("organizer_accounts")
        .select("stripe_account_id, payouts_enabled")
        .eq("host_id", promoter.user_id)
        .maybeSingle();
      if (orgError) throw orgError;
      if (org?.stripe_account_id && org?.payouts_enabled) {
        stripeAccountId = org.stripe_account_id;
      }
    }

    const holdShare = async (note: string) => {
      await checkedWrite(supabase
        .from("promoter_ledger_entries")
        .update({ payout_status: "held", payout_note: note })
        .eq("event_id", eventId)
        .eq("promoter_id", promoterId)
        .in("id", rowIds)
        .is("paid_out_at", null), rowIds.length);
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

    // Stamp the settled rows. Earnings carry the payout transfer id;
    // reversal rows keep their own (reversal) transfer id.
    await checkedWrite(supabase
      .from("promoter_ledger_entries")
      .update({
        paid_out_at: nowIso,
        payout_status: "paid",
        stripe_transfer_id: transfer.id,
      })
      .eq("event_id", eventId)
      .eq("promoter_id", promoterId)
        .in("id", rowIds)
      .eq("entry_type", "earning")
      .is("paid_out_at", null), rows.filter((r: any) => r.promoter_id === promoterId && r.entry_type === "earning").length);
    await checkedWrite(supabase
      .from("promoter_ledger_entries")
      .update({ paid_out_at: nowIso, payout_status: "paid" })
      .eq("event_id", eventId)
      .eq("promoter_id", promoterId)
        .in("id", rowIds)
      .eq("entry_type", "reversal")
      .is("paid_out_at", null), rows.filter((r: any) => r.promoter_id === promoterId && r.entry_type === "reversal").length);

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

Deno.serve(withSentry("payouts-release", async (req: Request) => {
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

  // WS-4 skip-if-running: TTL (15 min) self-heals a crashed run before the
  // documented hourly cadence. Per-event CAS + deterministic Stripe
  // Idempotency-Key are the real double-payout guards; this only stops overlap.
  const JOB = "payouts-release";
  if (!(await tryClaimJob(JOB, 900))) {
    return new Response(
      JSON.stringify({ skipped: true, reason: "already_running" }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }
  try {
   return await withHeartbeat(JOB, async () => {
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
        // Durable atomic claim using a schema-supported state. Never reset this
        // claim on timeout/error: Stripe keys expire and are NOT a durable ledger.
        // A held event needs reconciliation before any operator requeues it.
        const { data: claim, error: claimError } = await supabase.rpc(
          "settlement_claim_legacy_event", { p_event_id: event.id },
        );

        if (claimError) throw claimError;
        if (claim?.claimed !== true) {
          results.push({
            event_id: event.id,
            status: "skipped",
            reason: "already_claimed",
          });
          continue;
        }

        const verifiedGrossCents = await assertSafeRelease(supabase, event.id);

        // Check for active disputes on orders for this event
        const { data: disputedOrders, error: disputeError } = await supabase
          .from("orders")
          .select("id")
          .eq("event_id", event.id)
          .eq("status", "disputed")
          .limit(1);

        if (disputeError) throw disputeError;
        if (disputedOrders?.length) {
          await checkedWrite(supabase
            .from("events")
            .update({ payout_status: "on_hold" })
            .eq("id", event.id));
          results.push({
            event_id: event.id,
            status: "on_hold",
            // Aggregate financials include disputed tickets. Never fund them
            // by merely skipping the owner event-wide dispute policy.
            reason: isConfiguredPlatformOwner(event.host_id, Deno.env.get("DVNT_PLATFORM_OWNER_AUTH_ID"))
              ? "owner_dispute_requires_order_settlement"
              : "dispute",
          });
          continue;
        }

        // Compute financials in SQL. recompute_event_financials is the one
        // definition of gross/fee/net (tickets plus add-on purchases, 2.5%
        // + $1 per kept unit) and also keeps the Stripe processor-fee
        // ledger, which an upsert from here would overwrite. A failed
        // recompute throws: no transfer without a fresh summary.
        const { error: recomputeError } = await supabase.rpc(
          "recompute_event_financials",
          { p_event_id: event.id },
        );
        if (recomputeError) throw recomputeError;
        const { data: financials, error: financialsError } = await supabase
          .from("event_financials")
          .select("gross_cents, refunds_cents, dvnt_fee_cents, net_cents")
          .eq("event_id", event.id)
          .single();
        if (financialsError || !financials) {
          throw financialsError || new Error("event_financials row missing");
        }
        const grossCents = Number(financials.gross_cents || 0);
        const refundsCents = Number(financials.refunds_cents || 0);
        const organizerFeeCents = Number(financials.dvnt_fee_cents || 0);
        const netCents = Number(financials.net_cents || 0);
        if (![grossCents, refundsCents, organizerFeeCents, netCents].every(Number.isSafeInteger) ||
            netCents < 0 || netCents > verifiedGrossCents) {
          throw new Error("Invalid settlement budget; reconciliation required");
        }

        // Ticket counts for the statement email only. Add-on units are not
        // tickets and must not inflate "tickets sold".
        const { data: tickets } = await supabase
          .from("tickets")
          .select("status")
          .eq("event_id", event.id);
        const allTickets = tickets || [];
        const ticketCount = allTickets.filter(
          (t: any) => t.status !== "refunded" && t.status !== "void",
        ).length;
        const refundedTicketCount = allTickets.filter(
          (t: any) => t.status === "refunded",
        ).length;

        // ── Split ledger: net promoter cuts out of the organizer's take ──
        // Runs before the organizer transfer so their share is disbursed to
        // their own connected accounts (or held) and never lands in the
        // organizer's payout. Any uncertain result requires reconciliation.
        const windowKey =
          event.payout_release_at || event.end_date || String(event.id);
        // Persist intent BEFORE the first transfer. Even an erroneous/admin
        // requeue must encounter this evidence and stop for reconciliation.
        const payoutIntentId = crypto.randomUUID();
        await checkedWrite(supabase.from("payouts").insert({
          id: payoutIntentId,
          event_id: event.id,
          host_id: event.host_id,
          status: "pending",
          gross_cents: grossCents,
          release_at: event.payout_release_at,
        }));
        const settlement = await settlePromoters(
          supabase,
          event.id,
          windowKey,
          netCents,
        );
        const organizerNetCents = Math.max(
          0,
          netCents - settlement.totalCutCents,
        );

        if (organizerNetCents <= 0) {
          // Promoters may have been paid above; organizer has nothing left.
          await checkedWrite(supabase.from("payouts").update({
            status: settlement.heldCents > 0 ? "on_hold" : "paid",
            net_cents: 0,
          }).eq("id", payoutIntentId));
          await checkedWrite(supabase
            .from("events")
            .update({ payout_status: settlement.heldCents > 0 ? "on_hold" : "released" })
            .eq("id", event.id));
          results.push({
            event_id: event.id,
            status: settlement.heldCents > 0 ? "on_hold" : "released",
            net_cents: 0,
            promoter_paid_cents: settlement.paidCents,
            promoter_held_cents: settlement.heldCents,
            promoter_transfers: settlement.transfers,
          });
          continue;
        }

        // Get organizer's Stripe account
        const { data: organizer, error: organizerError } = await supabase
          .from("organizer_accounts")
          .select("stripe_account_id, payouts_enabled")
          .eq("host_id", event.host_id)
          .single();

        if (organizerError) throw organizerError;
        if (!organizer?.stripe_account_id || !organizer?.payouts_enabled) {
          await checkedWrite(supabase
            .from("events")
            .update({ payout_status: "on_hold" })
            .eq("id", event.id));
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

        // Record payout (organizer's net, after promoter split)
        await checkedWrite(supabase.from("payouts").update({
          event_id: event.id,
          host_id: event.host_id,
          stripe_payout_id: transfer.id,
          status: "paid",
          gross_cents: grossCents,
          net_cents: organizerNetCents,
          release_at: event.payout_release_at,
        }).eq("id", payoutIntentId));

        // Mark event payout as released
        await checkedWrite(supabase
          .from("events")
          .update({ payout_status: settlement.heldCents > 0 ? "on_hold" : "released" })
          .eq("id", event.id));

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
                  ticketsRefunded: refundedTicketCount,
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
          status: settlement.heldCents > 0 ? "on_hold" : "released",
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
      { status: results.some((r) => r.status === "error" || r.status === "on_hold") ? 503 : 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (err: any) {
    console.error("[payouts-release] Error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
   });
  } finally {
    await releaseJob(JOB);
  }
}));
