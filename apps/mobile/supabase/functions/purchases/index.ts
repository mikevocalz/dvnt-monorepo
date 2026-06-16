/**
 * Purchases Edge Function
 *
 * POST /purchases
 * Body: { action, order_id?, cursor?, ... }
 *
 * Actions:
 *   - list: paginated order history
 *   - detail: single order with timeline + tickets
 *   - receipt: get/generate receipt document
 *   - invoice: get/generate invoice document
 *   - refund_request: submit a refund request
 *   - refunds: list user's refund requests
 *   - disputes: list user's disputes
 *   - ticket_print: get print assets for an order
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  verifySession,
  jsonResponse,
  errorResponse,
  optionsResponse,
} from "../_shared/verify-session.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY") || "";

if (!STRIPE_SECRET_KEY) {
  console.error(
    "[purchases] FATAL: STRIPE_SECRET_KEY env var is not set.",
  );
}

async function stripeGet(endpoint: string): Promise<any> {
  const res = await fetch(`https://api.stripe.com/v1${endpoint}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${STRIPE_SECRET_KEY}` },
  });
  return res.json();
}

function mapOrderRow(row: any): any {
  return {
    id: row.id,
    status: row.status,
    type: row.type,
    currency: row.currency || "usd",
    fees: {
      subtotalCents: row.subtotal_cents || 0,
      platformFeeCents: row.platform_fee_cents || 0,
      processingFeeCents: row.processing_fee_cents || 0,
      taxCents: row.tax_cents || 0,
      totalCents: row.total_cents || 0,
    },
    paymentMethodLast4: row.payment_method_last4,
    paymentMethodBrand: row.payment_method_brand,
    stripePaymentIntentId: row.stripe_payment_intent_id,
    event: row.events
      ? {
          id: row.events.id?.toString() || row.event_id?.toString(),
          title: row.events.title || "",
          coverImageUrl: row.events.cover_image_url,
          startDate: row.events.start_date,
          location: row.events.location,
        }
      : row.event_id
        ? {
            id: row.event_id.toString(),
            title: "",
            coverImageUrl: null,
            startDate: null,
            location: null,
          }
        : undefined,
    tickets: row.order_tickets || [],
    timeline: row.order_timeline || [],
    receiptAvailable:
      row.status === "paid" ||
      row.status === "refunded" ||
      row.status === "partially_refunded",
    invoiceAvailable: false,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return optionsResponse();
  if (req.method !== "POST") return errorResponse("Method not allowed", 405);

  if (!STRIPE_SECRET_KEY) {
    return errorResponse(
      "Stripe is not configured for this environment. Contact support.",
      503,
    );
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` } },
    });
    const userId = await verifySession(supabase, req);
    if (!userId) return errorResponse("Unauthorized", 401);

    const body = await req.json();
    const { action } = body;

    switch (action) {
      // ── List orders ───────────────────────────────────────
      case "list": {
        const pageSize = 20;
        let query = supabase
          .from("orders")
          .select("*, events(id, title, cover_image_url, start_date, location)")
          .eq("user_id", userId)
          .order("created_at", { ascending: false })
          .limit(pageSize);

        if (body.cursor) {
          query = query.lt("created_at", body.cursor);
        }

        const { data, error } = await query;
        if (error) throw error;

        const orders = (data || []).map(mapOrderRow);
        const hasMore = orders.length === pageSize;
        const cursor = hasMore ? data[data.length - 1].created_at : undefined;

        return jsonResponse({ data: orders, hasMore, cursor });
      }

      // ── Order detail ──────────────────────────────────────
      case "detail": {
        const { order_id } = body;
        if (!order_id) return errorResponse("order_id required");

        const { data: order, error } = await supabase
          .from("orders")
          .select("*, events(id, title, cover_image_url, start_date, location)")
          .eq("id", order_id)
          .eq("user_id", userId)
          .single();

        if (error || !order) return errorResponse("Order not found", 404);

        // Get timeline
        const { data: timeline } = await supabase
          .from("order_timeline")
          .select("*")
          .eq("order_id", order_id)
          .order("created_at", { ascending: true });

        // Get tickets for this order
        const { data: tickets } = await supabase
          .from("tickets")
          .select("id, status, qr_token, ticket_types(name)")
          .eq("stripe_payment_intent_id", order.stripe_payment_intent_id)
          .eq("user_id", userId);

        const mappedTickets = (tickets || []).map((t: any) => ({
          id: t.id,
          ticketTypeName: t.ticket_types?.name || "General",
          qrToken: t.qr_token,
          status: t.status,
        }));

        const mappedTimeline = (timeline || []).map((t: any) => ({
          type: t.type,
          label: t.label,
          timestamp: t.created_at,
          detail: t.detail,
        }));

        const result = mapOrderRow(order);
        result.tickets = mappedTickets;
        result.timeline = mappedTimeline;

        return jsonResponse({ order: result });
      }

      // ── Receipt ───────────────────────────────────────────
      case "receipt": {
        const { order_id } = body;
        if (!order_id) return errorResponse("order_id required");

        const { data: order } = await supabase
          .from("orders")
          .select("*")
          .eq("id", order_id)
          .eq("user_id", userId)
          .single();

        if (!order) return errorResponse("Order not found", 404);

        // If we have a stored receipt PDF path, generate a signed URL
        if (order.receipt_pdf_path) {
          // For now return the path; in production this would be a signed URL
          return jsonResponse({
            orderId: order_id,
            type: "receipt",
            pdfUrl: order.receipt_pdf_path,
            expiresAt: new Date(Date.now() + 3600000).toISOString(),
            printModes: ["pdf", "thermal58", "thermal80"],
          });
        }

        // Try Stripe receipt URL from the charge
        if (order.stripe_payment_intent_id && STRIPE_SECRET_KEY) {
          try {
            const pi = await stripeGet(
              `/payment_intents/${order.stripe_payment_intent_id}`,
            );
            const chargeId = pi.latest_charge;
            if (chargeId) {
              const charge = await stripeGet(`/charges/${chargeId}`);
              if (charge.receipt_url) {
                return jsonResponse({
                  orderId: order_id,
                  type: "receipt",
                  pdfUrl: charge.receipt_url,
                  expiresAt: new Date(Date.now() + 3600000).toISOString(),
                  printModes: ["pdf", "thermal58", "thermal80"],
                });
              }
            }
          } catch (e) {
            console.error("[purchases] Stripe receipt fetch error:", e);
          }
        }

        // No PDF available — client will generate HTML fallback
        return jsonResponse(null);
      }

      // ── Invoice ───────────────────────────────────────────
      case "invoice": {
        const { order_id } = body;
        if (!order_id) return errorResponse("order_id required");

        const { data: order } = await supabase
          .from("orders")
          .select("*")
          .eq("id", order_id)
          .eq("user_id", userId)
          .single();

        if (!order) return errorResponse("Order not found", 404);

        if (order.invoice_pdf_path) {
          return jsonResponse({
            orderId: order_id,
            type: "invoice",
            pdfUrl: order.invoice_pdf_path,
            expiresAt: new Date(Date.now() + 3600000).toISOString(),
            printModes: ["pdf"],
          });
        }

        return jsonResponse(null);
      }

      // ── Refund request ────────────────────────────────────
      case "refund_request": {
        const { orderId, reason, notes } = body;
        if (!orderId || !reason)
          return errorResponse("orderId and reason required");

        // Verify order belongs to user and is refundable
        const { data: order } = await supabase
          .from("orders")
          .select("id, status, total_cents")
          .eq("id", orderId)
          .eq("user_id", userId)
          .single();

        if (!order) return errorResponse("Order not found", 404);
        if (order.status !== "paid") {
          return errorResponse("Order is not eligible for refund");
        }

        // Check for existing pending request
        const { data: existing } = await supabase
          .from("refund_requests")
          .select("id")
          .eq("order_id", orderId)
          .eq("status", "pending")
          .single();

        if (existing) {
          return errorResponse("A refund request is already pending");
        }

        // Create refund request
        const { data: refundReq, error: refundErr } = await supabase
          .from("refund_requests")
          .insert({
            order_id: orderId,
            user_id: userId,
            reason,
            notes: notes || null,
            amount_cents: order.total_cents,
          })
          .select("id")
          .single();

        if (refundErr) throw refundErr;

        // Add timeline event
        await supabase.from("order_timeline").insert({
          order_id: orderId,
          type: "refund_requested",
          label: "Refund requested",
          detail: `Reason: ${reason}`,
        });

        return jsonResponse({
          success: true,
          refundId: refundReq.id,
        });
      }

      // ── List refunds ──────────────────────────────────────
      case "refunds": {
        const { data, error } = await supabase
          .from("refund_requests")
          .select("*, orders(total_cents)")
          .eq("user_id", userId)
          .order("created_at", { ascending: false })
          .limit(50);

        if (error) throw error;

        const refunds = (data || []).map((r: any) => ({
          id: r.id,
          orderId: r.order_id,
          status:
            r.status === "approved" || r.status === "processed"
              ? "succeeded"
              : r.status === "denied"
                ? "failed"
                : r.status,
          amountCents: r.amount_cents || 0,
          currency: "usd",
          reason: r.reason,
          createdAt: r.created_at,
          completedAt: r.resolved_at,
          isPartial: r.amount_cents < (r.orders?.total_cents || 0),
          originalAmountCents: r.orders?.total_cents || r.amount_cents,
        }));

        return jsonResponse({ data: refunds, hasMore: false });
      }

      // ── List disputes ─────────────────────────────────────
      case "disputes": {
        // Disputes come from Stripe — query orders that are disputed
        const { data: disputedOrders, error } = await supabase
          .from("orders")
          .select(
            "id, total_cents, status, created_at, stripe_payment_intent_id",
          )
          .eq("user_id", userId)
          .eq("status", "disputed")
          .order("created_at", { ascending: false })
          .limit(50);

        if (error) throw error;

        const disputes = (disputedOrders || []).map((o: any) => ({
          id: o.id,
          orderId: o.id,
          status: "under_review",
          amountCents: o.total_cents,
          currency: "usd",
          reason: "Payment disputed",
          createdAt: o.created_at,
          actionRequired: false,
        }));

        return jsonResponse({ data: disputes, hasMore: false });
      }

      // ── Ticket print assets ───────────────────────────────
      case "ticket_print": {
        const { order_id } = body;
        if (!order_id) return errorResponse("order_id required");

        // Return print modes — client generates HTML locally
        return jsonResponse({
          printModes: ["pdf", "thermal58", "thermal80"],
        });
      }

      default:
        return errorResponse(`Unknown action: ${action}`);
    }
  } catch (err: any) {
    console.error("[purchases] Error:", err);
    return errorResponse(err.message || "Internal error", 500);
  }
});
