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
import { handleCartPaymentIntentSucceeded } from "../_shared/cart-issuance.ts";
import { issueTicketsForCheckoutSession } from "../_shared/session-issuance.ts";

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
    // needs_attention: paid at Stripe, no tickets, and no rail could issue
    // (no cart metadata, no session metadata, no hold). Non-zero means a
    // buyer has paid and is waiting — the signal that used to be swallowed
    // entirely.
    const stats = {
      reconciled: 0,
      expired_holds: 0,
      failed: 0,
      needs_attention: 0,
      abandoned: 0,
      by_status: {} as Record<string, number>,
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
        // deno-lint-ignore no-explicit-any
        let checkoutSession: any = null;
        // deno-lint-ignore no-explicit-any
        let paymentIntentObj: any = null;

        // Check PaymentIntent status
        if (order.stripe_payment_intent_id) {
          const piRes = await fetch(
            `https://api.stripe.com/v1/payment_intents/${order.stripe_payment_intent_id}`,
            { headers: { Authorization: `Bearer ${STRIPE_SECRET_KEY}` } },
          );
          const pi = await piRes.json();
          paymentIntentObj = pi;
          if (pi.error) {
            console.error(
              `[reconcile] Order ${order.id} Stripe error:`,
              pi.error,
            );
          }
          piStatus = pi.status ||
            (pi.error ? `error:${pi.error.code || pi.error.type}` : "unknown");

          // Orders stamped with a PI by an earlier sweep also carry the
          // session id — fetch it so the session rail below can issue.
          if (order.stripe_checkout_session_id) {
            const csRes = await fetch(
              `https://api.stripe.com/v1/checkout/sessions/${order.stripe_checkout_session_id}`,
              { headers: { Authorization: `Bearer ${STRIPE_SECRET_KEY}` } },
            );
            checkoutSession = await csRes.json();
          }
        }
        // Check Checkout Session status
        else if (order.stripe_checkout_session_id) {
          const csRes = await fetch(
            `https://api.stripe.com/v1/checkout/sessions/${order.stripe_checkout_session_id}`,
            { headers: { Authorization: `Bearer ${STRIPE_SECRET_KEY}` } },
          );
          const cs = await csRes.json();
          checkoutSession = cs;
          if (cs.error) {
            console.error(
              `[reconcile] Order ${order.id} Stripe error:`,
              cs.error,
            );
          }
          piStatus = cs.payment_status ||
            (cs.error ? `error:${cs.error.code || cs.error.type}` : "unknown");
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

        stats.by_status[piStatus] = (stats.by_status[piStatus] ?? 0) + 1;

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

          if ((alreadyIssued || 0) === 0 && orderRow.cart_id) {
            // Cart rail: cart_complete_issuance is idempotent
            // (duplicate:true on replay) and flips the order to paid itself.
            if (!paymentIntentObj && resolvedPaymentIntentId) {
              const r = await fetch(
                `https://api.stripe.com/v1/payment_intents/${resolvedPaymentIntentId}`,
                {
                  headers: {
                    Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
                  },
                },
              );
              paymentIntentObj = await r.json();
            }
            if (!paymentIntentObj?.metadata?.cart_id) {
              stats.needs_attention = (stats.needs_attention ?? 0) + 1;
              console.error(
                `[reconcile] PAID BUT UNISSUED order=${order.id} pi=${resolvedPaymentIntentId} cart=${orderRow.cart_id} — PaymentIntent is missing cart metadata; not claiming`,
              );
              await supabase.from("order_timeline").insert({
                order_id: order.id,
                type: "reconcile_blocked",
                label: "Paid, tickets not issued yet",
                detail:
                  "Payment confirmed at Stripe but the PaymentIntent has no cart metadata, so this job cannot replay cart issuance. Left pending; retried each run.",
              });
              continue;
            }
            await handleCartPaymentIntentSucceeded(supabase, paymentIntentObj);
            // The handler returns true for success, duplicate AND the
            // allocation-failure path (refund + payment_failed) — re-read
            // the order status to tell them apart.
            const { data: postCartOrder } = await supabase
              .from("orders")
              .select("status")
              .eq("id", order.id)
              .single();
            if (postCartOrder?.status === "paid") {
              await supabase.from("order_timeline").insert({
                order_id: order.id,
                type: "reconciled",
                label: "Payment reconciled",
                detail:
                  "Cart issuance replayed by reconciliation job — webhook was missed",
              });
              stats.reconciled++;
              console.log(
                `[reconcile] Order ${order.id} cart-issued → paid`,
              );
            } else {
              stats.failed++;
              console.error(
                `[reconcile] Order ${order.id} cart issuance did not complete (status=${postCartOrder?.status})`,
              );
            }
            continue;
          }

          if (
            (alreadyIssued || 0) === 0 &&
            checkoutSession?.metadata?.type === "event_ticket"
          ) {
            // Session rail (guest + authed hosted checkout). Idempotent via
            // the (session_id, order_index) unique index; flips the order to
            // paid itself.
            const result = await issueTicketsForCheckoutSession(
              supabase,
              checkoutSession,
              {
                eventCreatedAt: new Date().toISOString(),
                logPrefix: "[reconcile]",
              },
            );
            await supabase.from("order_timeline").insert({
              order_id: order.id,
              type: "reconciled",
              label: "Payment reconciled",
              detail: result.alreadyIssued
                ? "Tickets already existed; order state repaired by reconciliation job"
                : `${result.issued} ticket(s) issued by reconciliation job — webhook was missed`,
            });
            stats.reconciled++;
            console.log(
              `[reconcile] Order ${order.id} session-issued → paid`,
            );
            continue;
          }

          // PaymentSheet rail only: carts and session orders were dispatched
          // above; anything else without a hold to issue from stays pending.
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
          // Hosted Checkout stays open ~24h: an "open" session whose
          // payment_status resolved to unpaid is an abandoned checkout, not
          // a failed payment. Expire it at Stripe first so no stale client
          // can still complete it, then fail the order. If the expire call
          // doesn't land (e.g. it just completed), leave it pending — the
          // webhook or the next run resolves it.
          if (checkoutSession?.status === "open") {
            const expireRes = await fetch(
              `https://api.stripe.com/v1/checkout/sessions/${order.stripe_checkout_session_id}/expire`,
              {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
                  "Content-Type": "application/x-www-form-urlencoded",
                },
              },
            );
            const expired = await expireRes.json();
            if (expired.status !== "expired") {
              console.error(
                `[reconcile] Order ${order.id} session expire did not land:`,
                expired?.error?.message ?? expired?.status,
              );
              continue;
            }
          }

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
        } else if (
          ["requires_payment_method", "requires_confirmation", "requires_action"]
            .includes(piStatus) &&
          order.stripe_payment_intent_id
        ) {
          // Abandoned PaymentSheet: the intent was minted but never confirmed,
          // and this order is already past the cutoff (default 2h) while its
          // hold was 10 min. If a hold is somehow still active the buyer is
          // inside the window — leave it. Otherwise cancel at Stripe FIRST so
          // a stale client cannot confirm against inventory it no longer
          // holds, then fail the order.
          const { count: liveHolds } = await supabase
            .from("ticket_holds")
            .select("*", { count: "exact", head: true })
            .eq("payment_intent_id", order.stripe_payment_intent_id)
            .eq("status", "active");
          if ((liveHolds || 0) > 0) {
            console.log(
              `[reconcile] Order ${order.id} ${piStatus} but hold still active — leaving`,
            );
          } else {
            const cancelRes = await fetch(
              `https://api.stripe.com/v1/payment_intents/${order.stripe_payment_intent_id}/cancel`,
              {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
                  "Content-Type": "application/x-www-form-urlencoded",
                },
                body: "cancellation_reason=abandoned",
              },
            );
            const cancelled = await cancelRes.json();
            if (cancelled.status === "canceled") {
              await supabase
                .from("orders")
                .update({
                  status: "payment_failed",
                  updated_at: new Date().toISOString(),
                })
                .eq("id", order.id)
                .eq("status", "payment_pending");
              await supabase.from("order_timeline").insert({
                order_id: order.id,
                type: "payment_failed",
                label: "Checkout abandoned",
                detail:
                  `PaymentIntent was ${piStatus} past the reconciliation cutoff; cancelled at Stripe by reconciliation job`,
              });
              stats.abandoned++;
              console.log(
                `[reconcile] Order ${order.id} → payment_failed (abandoned, PI cancelled)`,
              );
            } else {
              // Race: it may have just been confirmed. Leave it; next run
              // sees the new status.
              console.error(
                `[reconcile] Order ${order.id} PI cancel did not land:`,
                cancelled?.error?.message ?? cancelled?.status,
              );
            }
          }
        } else if (piStatus === "error:resource_missing") {
          // The PaymentIntent / Session does not exist under this Stripe
          // key — minted under a test key or a previous account. No money
          // can ever be collected against it here, so the order cannot
          // become paid. Fail it.
          await supabase
            .from("orders")
            .update({
              status: "payment_failed",
              updated_at: new Date().toISOString(),
            })
            .eq("id", order.id)
            .eq("status", "payment_pending");
          await supabase.from("order_timeline").insert({
            order_id: order.id,
            type: "payment_failed",
            label: "Payment reference not found",
            detail:
              "Stripe has no record of this order's PaymentIntent/Session under the live key; closed by reconciliation job",
          });
          stats.failed++;
          console.log(
            `[reconcile] Order ${order.id} → payment_failed (stripe resource_missing)`,
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
