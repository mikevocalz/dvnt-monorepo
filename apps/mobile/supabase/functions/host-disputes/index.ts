/**
 * Host Disputes Edge Function
 *
 * POST /host-disputes
 * Body: { action: "list" }
 *
 * Returns disputes/chargebacks for organizer's events.
 * Combines Stripe dispute data with local order/ticket data.
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
    "[host-disputes] FATAL: STRIPE_SECRET_KEY env var is not set.",
  );
}

async function stripeGet(
  endpoint: string,
  stripeAccount?: string,
): Promise<any> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
  };
  if (stripeAccount) {
    headers["Stripe-Account"] = stripeAccount;
  }
  const res = await fetch(`https://api.stripe.com/v1${endpoint}`, {
    method: "GET",
    headers,
  });
  return res.json();
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

    // Verify organizer
    const { data: orgAccount } = await supabase
      .from("organizer_accounts")
      .select("stripe_account_id")
      .eq("host_id", userId)
      .single();

    if (!orgAccount?.stripe_account_id) {
      return errorResponse("Not an organizer", 403);
    }

    const body = await req.json();
    const { action } = body;

    if (action !== "list") return errorResponse(`Unknown action: ${action}`);

    const disputes: any[] = [];

    // Strategy: get disputed orders for host's events
    const { data: hostEvents } = await supabase
      .from("events")
      .select("id")
      .eq("host_id", userId);

    const hostEventIds = (hostEvents || []).map((e: any) => e.id);

    if (hostEventIds.length === 0) {
      return jsonResponse({ data: [], hasMore: false });
    }

    // Get orders that are disputed for host's events
    const { data: disputedOrders } = await supabase
      .from("orders")
      .select(
        "id, total_cents, status, created_at, stripe_payment_intent_id, event_id, events(title)",
      )
      .in("event_id", hostEventIds)
      .eq("status", "disputed")
      .order("created_at", { ascending: false })
      .limit(50);

    for (const o of disputedOrders || []) {
      let stripeDispute: any = null;

      // Try to get dispute details from Stripe
      if (STRIPE_SECRET_KEY && o.stripe_payment_intent_id) {
        try {
          const piDisputes = await stripeGet(
            `/disputes?payment_intent=${o.stripe_payment_intent_id}&limit=1`,
          );
          if (piDisputes.data?.length > 0) {
            stripeDispute = piDisputes.data[0];
          }
        } catch (e) {
          console.error("[host-disputes] Stripe fetch error:", e);
        }
      }

      const dispute: any = {
        id: stripeDispute?.id || `dispute-${o.id}`,
        orderId: o.id,
        status: stripeDispute?.status || "needs_response",
        amountCents: stripeDispute?.amount || o.total_cents || 0,
        currency: stripeDispute?.currency || "usd",
        reason: stripeDispute?.reason || "general",
        createdAt: stripeDispute
          ? new Date(stripeDispute.created * 1000).toISOString()
          : o.created_at,
        eventTitle: o.events?.title || "",
        actionRequired: false,
        actionDescription: null,
        evidenceDueBy: null,
        resolvedAt: null,
      };

      // Parse Stripe dispute status
      if (stripeDispute) {
        const needsResponse =
          stripeDispute.status === "needs_response" ||
          stripeDispute.status === "warning_needs_response";

        dispute.actionRequired = needsResponse;

        if (needsResponse && stripeDispute.evidence_details?.due_by) {
          dispute.evidenceDueBy = new Date(
            stripeDispute.evidence_details.due_by * 1000,
          ).toISOString();
          dispute.actionDescription = "Submit evidence before deadline";
        }

        if (stripeDispute.status === "won" || stripeDispute.status === "lost") {
          dispute.resolvedAt = new Date().toISOString();
        }
      }

      disputes.push(dispute);
    }

    // Also check Stripe directly for disputes on the connected account
    // that may not have orders yet (e.g. from direct charges)
    if (STRIPE_SECRET_KEY) {
      try {
        const stripeDisputes = await stripeGet(
          `/disputes?limit=20`,
          orgAccount.stripe_account_id,
        );

        if (stripeDisputes.data) {
          const existingIds = new Set(disputes.map((d: any) => d.id));
          for (const sd of stripeDisputes.data) {
            if (!existingIds.has(sd.id)) {
              disputes.push({
                id: sd.id,
                orderId: null,
                status: sd.status,
                amountCents: sd.amount,
                currency: sd.currency || "usd",
                reason: sd.reason || "general",
                createdAt: new Date(sd.created * 1000).toISOString(),
                eventTitle: "",
                actionRequired:
                  sd.status === "needs_response" ||
                  sd.status === "warning_needs_response",
                actionDescription:
                  sd.status === "needs_response"
                    ? "Submit evidence before deadline"
                    : null,
                evidenceDueBy: sd.evidence_details?.due_by
                  ? new Date(sd.evidence_details.due_by * 1000).toISOString()
                  : null,
                resolvedAt:
                  sd.status === "won" || sd.status === "lost"
                    ? new Date().toISOString()
                    : null,
              });
            }
          }
        }
      } catch (e) {
        console.error("[host-disputes] Stripe disputes list error:", e);
      }
    }

    // Sort by date descending
    disputes.sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );

    return jsonResponse({ data: disputes, hasMore: false });
  } catch (err: any) {
    console.error("[host-disputes] Error:", err);
    return errorResponse(err.message || "Internal error", 500);
  }
});
