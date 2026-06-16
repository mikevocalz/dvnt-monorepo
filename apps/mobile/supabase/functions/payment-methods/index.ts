/**
 * Payment Methods Edge Function
 *
 * POST /payment-methods
 * Body: { action: "list" | "setup" | "set_default" | "remove", method_id? }
 *
 * Manages Stripe PaymentMethods via Customer objects.
 * Auto-creates Stripe Customer if not exists.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  verifySession,
  jsonResponse,
  errorResponse,
  optionsResponse,
} from "../_shared/verify-session.ts";

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY") || "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

if (!STRIPE_SECRET_KEY) {
  console.error(
    "[payment-methods] FATAL: STRIPE_SECRET_KEY env var is not set.",
  );
}

async function stripeGet(endpoint: string): Promise<any> {
  const res = await fetch(`https://api.stripe.com/v1${endpoint}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${STRIPE_SECRET_KEY}` },
  });
  return res.json();
}

async function stripePost(
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
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data;
}

async function stripeDelete(endpoint: string): Promise<any> {
  const res = await fetch(`https://api.stripe.com/v1${endpoint}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${STRIPE_SECRET_KEY}` },
  });
  return res.json();
}

/**
 * Get or create Stripe Customer for a DVNT user.
 */
async function getOrCreateCustomer(
  supabase: any,
  userId: string,
): Promise<string> {
  // Check stripe_customers table
  const { data: existing } = await supabase
    .from("stripe_customers")
    .select("stripe_customer_id")
    .eq("user_id", userId)
    .single();

  if (existing?.stripe_customer_id) {
    return existing.stripe_customer_id;
  }

  // Look up user email from Better Auth user table
  const { data: baUser } = await supabase
    .from("user")
    .select("email, name")
    .eq("id", userId)
    .single();

  // Create Stripe Customer
  const customer = await stripePost("/customers", {
    ...(baUser?.email ? { email: baUser.email } : {}),
    ...(baUser?.name ? { name: baUser.name } : {}),
    "metadata[dvnt_user_id]": userId,
  });

  // Store mapping
  await supabase.from("stripe_customers").insert({
    user_id: userId,
    stripe_customer_id: customer.id,
  });

  return customer.id;
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

    const { action, method_id } = await req.json();

    switch (action) {
      case "list": {
        const customerId = await getOrCreateCustomer(supabase, userId);
        const result = await stripeGet(
          `/payment_methods?customer=${customerId}&type=card`,
        );

        // Also get the default payment method
        const customer = await stripeGet(`/customers/${customerId}`);
        const defaultMethodId =
          customer.invoice_settings?.default_payment_method || null;

        const methods = (result.data || []).map((pm: any) => ({
          id: pm.id,
          type: pm.type,
          isDefault: pm.id === defaultMethodId,
          card: pm.card
            ? {
                brand: pm.card.brand,
                last4: pm.card.last4,
                expMonth: pm.card.exp_month,
                expYear: pm.card.exp_year,
                funding: pm.card.funding,
              }
            : undefined,
          createdAt: new Date(pm.created * 1000).toISOString(),
        }));

        return jsonResponse({ methods });
      }

      case "setup": {
        const customerId = await getOrCreateCustomer(supabase, userId);

        // Create SetupIntent
        const setupIntent = await stripePost("/setup_intents", {
          customer: customerId,
          "payment_method_types[0]": "card",
          "metadata[dvnt_user_id]": userId,
        });

        // Create ephemeral key for the PaymentSheet
        const ephemeralKey = await fetch(
          "https://api.stripe.com/v1/ephemeral_keys",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
              "Content-Type": "application/x-www-form-urlencoded",
              "Stripe-Version": "2024-06-20",
            },
            body: new URLSearchParams({ customer: customerId }).toString(),
          },
        ).then((r) => r.json());

        return jsonResponse({
          clientSecret: setupIntent.client_secret,
          ephemeralKey: ephemeralKey.secret,
          customerId,
        });
      }

      case "set_default": {
        if (!method_id) return errorResponse("method_id required");
        const customerId = await getOrCreateCustomer(supabase, userId);

        // Verify PM belongs to this customer (prevent IDOR)
        const pmDetail = await stripeGet(`/payment_methods/${method_id}`);
        if (pmDetail.error || pmDetail.customer !== customerId) {
          return errorResponse("Payment method not found or not yours", 403);
        }

        await stripePost(`/customers/${customerId}`, {
          "invoice_settings[default_payment_method]": method_id,
        });

        return jsonResponse({ success: true });
      }

      case "remove": {
        if (!method_id) return errorResponse("method_id required");
        const rmCustomerId = await getOrCreateCustomer(supabase, userId);

        // Verify PM belongs to this customer (prevent IDOR)
        const rmPm = await stripeGet(`/payment_methods/${method_id}`);
        if (rmPm.error || rmPm.customer !== rmCustomerId) {
          return errorResponse("Payment method not found or not yours", 403);
        }

        await stripePost(`/payment_methods/${method_id}/detach`, {});
        return jsonResponse({ success: true });
      }

      default:
        return errorResponse(`Unknown action: ${action}`);
    }
  } catch (err: any) {
    console.error("[payment-methods] Error:", err);
    return errorResponse(err.message || "Internal error", 500);
  }
});
