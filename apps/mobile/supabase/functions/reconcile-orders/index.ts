/**
 * Reconcile Orders Edge Function
 *
 * POST /reconcile-orders
 * Body: { hours_back?: number }
 *
 * Finds orders stuck in "payment_pending" and reconciles them
 * against Stripe PaymentIntent status. Also expires stale ticket holds.
 *
 * Should be called periodically (e.g. every 15 minutes via cron).
 */

import { withSentry } from "../_shared/sentry.ts";
import { withHeartbeat, tryClaimJob, releaseJob } from "../_shared/heartbeat.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createSignedQrPayload } from "../_shared/hmac-qr.ts";

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY") || "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const CRON_SECRET = Deno.env.get("CRON_SECRET") || "";

if (!STRIPE_SECRET_KEY) {
  console.error(
    "[reconcile-orders] FATAL: STRIPE_SECRET_KEY env var is not set. Cron will refuse to run.",
  );
}

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...cors },
  });
}

Deno.serve(withSentry("reconcile-orders", async (req: Request) => {
  if (req.method === "OPTIONS")
    return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  if (!STRIPE_SECRET_KEY) {
    return json(
      { error: "Stripe is not configured. Reconciliation cannot run." },
      503,
    );
  }

  // ── Auth: require cron secret header ────────────────────
  if (CRON_SECRET) {
    const provided = req.headers.get("x-cron-secret") || "";
    if (provided !== CRON_SECRET) {
      return json({ error: "Unauthorized" }, 401);
    }
  } else {
    console.error("[reconcile] CRON_SECRET not set — rejecting request");
    return json({ error: "Misconfigured" }, 500);
  }

  // WS-4 skip-if-running: TTL (5 min) < the documented 15-min cadence so a
  // crashed run self-heals before the next tick. The per-order CAS below is
  // the real double-issue guard; this only stops overlap stampedes.
  const JOB = "reconcile-orders";
  if (!(await tryClaimJob(JOB, 300))) {
    return json({ skipped: true, reason: "already_running" }, 200);
  }
  try {
   return await withHeartbeat(JOB, async () => {
  try {
    const body = await req.json().catch(() => ({}));
    const rawHours = Number(body.hours_back);
    const hoursBack =
      Number.isFinite(rawHours) && rawHours > 0 && rawHours <= 48
        ? rawHours
        : 2;

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` } },
    });

    const cutoff = new Date(
      Date.now() - hoursBack * 60 * 60 * 1000,
    ).toISOString();
    // needs_attention: paid at Stripe, no tickets, and this job cannot issue
    // for that rail. Non-zero means a buyer has paid and is waiting — the
    // signal that used to be swallowed entirely.
    const stats = {
      reconciled: 0,
      expired_holds: 0,
      failed: 0,
      needs_attention: 0,
    };

    // ── 1. Expire stale ticket holds ─────────────────────────
    const { data: staleHolds, error: holdsError } = await supabase
      .from("ticket_holds")
      .update({ status: "expired" })
      .eq("status", "active")
      .lt("expires_at", new Date().toISOString())
      .select("id");

    if (!holdsError && staleHolds) {
      stats.expired_holds = staleHolds.length;
    }

    // ── 2. Find stuck payment_pending orders ─────────────────
    const { data: pendingOrders, error: ordersError } = await supabase
      .from("orders")
      .select(
        "id, stripe_payment_intent_id, stripe_checkout_session_id, created_at",
      )
      .eq("status", "payment_pending")
      .lt("created_at", cutoff)
      .limit(50);

    if (ordersError) {
      console.error("[reconcile] Orders fetch error:", ordersError);
      return json({ error: "Failed to fetch orders" }, 500);
    }

    for (const order of pendingOrders || []) {
      try {
        let piStatus = "unknown";
        // Session-keyed orders (guest rail) carry no PaymentIntent id of their
        // own. Resolve it from the session so the issuance branch below is not
        // blind to them — it used to skip every guest order outright, flipping
        // it to 'paid' with zero tickets and never selecting it again.
        let resolvedPaymentIntentId: string | null =
          order.stripe_payment_intent_id ?? null;

        // Check PaymentIntent status
        if (order.stripe_payment_intent_id) {
          const piRes = await fetch(
            `https://api.stripe.com/v1/payment_intents/${order.stripe_payment_intent_id}`,
            { headers: { Authorization: `Bearer ${STRIPE_SECRET_KEY}` } },
          );
          const pi = await piRes.json();
          piStatus = pi.status || "unknown";
        }
        // Check Checkout Session status
        else if (order.stripe_checkout_session_id) {
          const csRes = await fetch(
            `https://api.stripe.com/v1/checkout/sessions/${order.stripe_checkout_session_id}`,
            { headers: { Authorization: `Bearer ${STRIPE_SECRET_KEY}` } },
          );
          const cs = await csRes.json();
          piStatus = cs.payment_status || "unknown";
          if (typeof cs.payment_intent === "string" && cs.payment_intent) {
            resolvedPaymentIntentId = cs.payment_intent;
          } else if (cs.payment_intent?.id) {
            resolvedPaymentIntentId = cs.payment_intent.id;
          }
          if (resolvedPaymentIntentId && !order.stripe_payment_intent_id) {
            // Persist it so later runs, refunds and the webhook's
            // orders-by-PI lookups can all find this order.
            await supabase
              .from("orders")
              .update({ stripe_payment_intent_id: resolvedPaymentIntentId })
              .eq("id", order.id)
              .is("stripe_payment_intent_id", null);
          }
          // Async settlement (ACH / bank transfer): a COMPLETE session
          // can stay payment_status='unpaid' for days while funds are in
          // flight. That is NOT a failure — leave the order pending; the
          // async_payment_succeeded/failed webhooks (or a later sweep
          // once the hold's expires_at passes) resolve it.
          if (piStatus === "unpaid" && cs.status === "complete") {
            piStatus = "processing";
          }
        }

        // Reconcile based on status
        if (piStatus === "succeeded" || piStatus === "paid") {
          // Payment succeeded — the webhook was missed.
          //
          // Decide whether we can actually ISSUE before claiming the order.
          // Flipping to 'paid' first was the bug: the status change took the
          // order out of the payment_pending queue this job selects, so any
          // order it could not issue for (guest rail, cart rail, missing
          // hold) was charged, marked paid, given zero tickets, and never
          // looked at again — with no alert.
          const { data: orderRow } = await supabase
            .from("orders")
            .select("id, user_id, event_id, quantity, cart_id, guest_email")
            .eq("id", order.id)
            .eq("status", "payment_pending")
            .single();

          if (!orderRow) continue; // already handled by a webhook or another run

          const { count: alreadyIssued } = resolvedPaymentIntentId
            ? await supabase
                .from("tickets")
                .select("*", { count: "exact", head: true })
                .eq("stripe_payment_intent_id", resolvedPaymentIntentId)
            : { count: 0 };

          // The cart rail's issuance is the webhook's cart_complete_issuance
          // path; replaying it here would risk double-issuing, which is worse
          // than waiting. Same for guest tickets, which need the lookup token
          // and confirmation email the webhook sends.
          const canIssueHere =
            !orderRow.cart_id &&
            !orderRow.guest_email &&
            !!orderRow.event_id &&
            !!resolvedPaymentIntentId;

          if ((alreadyIssued || 0) === 0 && !canIssueHere) {
            // Leave it payment_pending so this job keeps retrying and the
            // order stays visible, and make the situation loud.
            stats.needs_attention = (stats.needs_attention ?? 0) + 1;
            console.error(
              `[reconcile] PAID BUT UNISSUED order=${order.id} pi=${resolvedPaymentIntentId} cart=${orderRow.cart_id} guest=${!!orderRow.guest_email} — webhook has not issued; not claiming`,
            );
            await supabase.from("order_timeline").insert({
              order_id: order.id,
              type: "reconcile_blocked",
              label: "Paid, tickets not issued yet",
              detail:
                "Payment confirmed at Stripe but no tickets exist and this job cannot issue for this rail. Left pending for the webhook; retried each run.",
            });
            continue;
          }

          // Safe to claim: either tickets already exist, or we can issue below.
          const { data: claimedOrder, error: claimErr } = await supabase
            .from("orders")
            .update({
              status: "paid",
              paid_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq("id", order.id)
            .eq("status", "payment_pending")
            .select("id, user_id, event_id, quantity, stripe_payment_intent_id")
            .single();

          if (claimErr || !claimedOrder) {
            // Already reconciled by another run or webhook
            continue;
          }

          // Issue tickets if webhook missed them
          if (claimedOrder.event_id && claimedOrder.stripe_payment_intent_id) {
            const { count: existingCount } = await supabase
              .from("tickets")
              .select("*", { count: "exact", head: true })
              .eq(
                "stripe_payment_intent_id",
                claimedOrder.stripe_payment_intent_id,
              );

            if ((existingCount || 0) === 0) {
              // Fetch ticket_type_id from holds or order metadata
              const { data: hold } = await supabase
                .from("ticket_holds")
                .select("ticket_type_id")
                .eq("payment_intent_id", claimedOrder.stripe_payment_intent_id)
                .limit(1)
                .single();

              if (hold?.ticket_type_id) {
                const qty = claimedOrder.quantity || 1;
                const ticketRows = [];
                for (let i = 0; i < qty; i++) {
                  const ticketUuid = crypto.randomUUID();
                  const { qrToken, qrPayload } = await createSignedQrPayload(
                    ticketUuid,
                    claimedOrder.event_id,
                  );
                  ticketRows.push({
                    id: ticketUuid,
                    event_id: claimedOrder.event_id,
                    ticket_type_id: hold.ticket_type_id,
                    user_id: claimedOrder.user_id,
                    status: "active",
                    qr_token: qrToken,
                    qr_payload: qrPayload,
                    stripe_payment_intent_id:
                      claimedOrder.stripe_payment_intent_id,
                  });
                }
                await supabase.from("tickets").insert(ticketRows);

                // Convert hold
                await supabase
                  .from("ticket_holds")
                  .update({ status: "converted" })
                  .eq(
                    "payment_intent_id",
                    claimedOrder.stripe_payment_intent_id,
                  )
                  .eq("status", "active");

                console.log(
                  `[reconcile] Issued ${qty} tickets for order ${order.id}`,
                );
              }
            }
          }

          await supabase.from("order_timeline").insert({
            order_id: order.id,
            type: "reconciled",
            label: "Payment reconciled",
            detail:
              "Caught by reconciliation job — webhook may have been missed",
          });

          stats.reconciled++;
          console.log(`[reconcile] Order ${order.id} reconciled → paid`);
        } else if (
          piStatus === "canceled" ||
          piStatus === "expired" ||
          piStatus === "unpaid"
        ) {
          // Payment failed/expired — mark order accordingly.
          // CAS on payment_pending, same as the paid path: without it a
          // webhook that lands mid-run could be stomped back to failed.
          await supabase
            .from("orders")
            .update({
              status: "payment_failed",
              updated_at: new Date().toISOString(),
            })
            .eq("id", order.id)
            .eq("status", "payment_pending");

          stats.failed++;
          console.log(
            `[reconcile] Order ${order.id} → payment_failed (${piStatus})`,
          );
        }
        // else: still processing, leave as-is
      } catch (err) {
        console.error(`[reconcile] Error processing order ${order.id}:`, err);
      }
    }

    console.log("[reconcile] Complete:", stats);
    return json({ success: true, stats });
  } catch (err: any) {
    console.error("[reconcile] Error:", err);
    return json({ error: err.message || "Internal error" }, 500);
  }
   });
  } finally {
    await releaseJob(JOB);
  }
}));
