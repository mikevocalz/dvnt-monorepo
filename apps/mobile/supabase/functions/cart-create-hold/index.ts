/**
 * cart-create-hold Edge Function
 *
 * POST /cart-create-hold
 * Body:
 *   {
 *     cartId,
 *     eventId,
 *     idempotencyKey,
 *     unlockCodes?: string[],            // locked-tier codes → RPC p_unlock_codes
 *     lineItems: [{
 *       lineItemId,
 *       category: "admission" | "coat_check" | "product" | "service" | "addon",
 *       tierId,                          // ticket lines
 *       addonId?, variantId?,            // addon lines (tierId null)
 *       boundTicketLineItemId?,          // per_ticket addon → its ticket line
 *       unlockCode?,                     // per-line alternative to unlockCodes
 *       quantity,
 *       unitPriceCents,
 *       attendees?,
 *       metadata?
 *     }]
 *   }
 *
 * Persists the cart draft, replaces its draft line items, then calls the
 * database RPC that performs the inventory check and hold insert in one
 * transaction. Deploy with --no-verify-jwt.
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

type LineItemCategory =
  | "admission"
  | "coat_check"
  | "product"
  | "service"
  | "addon";

type CartCreateHoldLineItem = {
  lineItemId: string;
  category: LineItemCategory;
  tierId: string | null;
  addonId: string | null;
  variantId: string | null;
  boundLineItemId: string | null;
  quantity: number;
  unitPriceCents: number;
  attendees?: unknown;
  metadata?: Record<string, unknown>;
};

type CartCreateHoldBody = {
  cartId: string;
  eventId: number;
  idempotencyKey: string;
  lineItems: CartCreateHoldLineItem[];
  /** Locked-tier unlock codes → RPC p_unlock_codes (v3, 20260806201000).
   *  Codes are compared server-side only, never echoed. */
  unlockCodes: string[];
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function validateBody(input: unknown): CartCreateHoldBody | { error: string } {
  if (!isRecord(input)) return { error: "Invalid request body" };

  const cartId = String(input.cartId || "").trim();
  const eventId = Number(input.eventId);
  const idempotencyKey = String(input.idempotencyKey || "").trim();
  const rawLineItems = input.lineItems;

  if (!UUID_RE.test(cartId)) return { error: "Invalid cartId" };
  if (!Number.isInteger(eventId) || eventId <= 0) {
    return { error: "Invalid eventId" };
  }
  if (!idempotencyKey || idempotencyKey.length > 120) {
    return { error: "Invalid idempotencyKey" };
  }
  if (!Array.isArray(rawLineItems) || rawLineItems.length === 0) {
    return { error: "Cart is empty" };
  }
  if (rawLineItems.length > 20) {
    return { error: "Too many line items" };
  }

  const seenLineItemIds = new Set<string>();
  const lineItems: CartCreateHoldLineItem[] = [];
  const unlockCodes: string[] = [];

  // Top-level unlockCodes: flat array of code strings (≤ 20, ≤ 64 chars each).
  if (Array.isArray(input.unlockCodes)) {
    for (const raw of input.unlockCodes.slice(0, 20)) {
      const code = String(raw ?? "").trim();
      if (code && code.length <= 64) unlockCodes.push(code);
    }
  }

  for (const raw of rawLineItems) {
    if (!isRecord(raw)) return { error: "Invalid line item" };

    const lineItemId = String(raw.lineItemId || "").trim();
    const category = raw.category;
    const tierId = String(raw.tierId || "").trim();
    const addonId = String(raw.addonId || "").trim();
    const variantId = String(raw.variantId || "").trim();
    const boundLineItemId = String(raw.boundTicketLineItemId || "").trim();
    const quantity = Number(raw.quantity);
    const unitPriceCents = Number(raw.unitPriceCents);
    const metadata = isRecord(raw.metadata) ? raw.metadata : {};

    // Per-line unlockCode (CartLineItemDTO.unlockCode) folds into the array.
    const lineUnlockCode = String(raw.unlockCode ?? "").trim();
    if (lineUnlockCode && lineUnlockCode.length <= 64) {
      unlockCodes.push(lineUnlockCode);
    }

    if (!UUID_RE.test(lineItemId)) return { error: "Invalid lineItemId" };
    if (seenLineItemIds.has(lineItemId)) {
      return { error: "Duplicate lineItemId" };
    }
    seenLineItemIds.add(lineItemId);

    const VALID = ["admission", "coat_check", "product", "service", "addon"];
    if (!VALID.includes(category as string)) {
      return { error: "Invalid line item category" };
    }
    // An "addon" line targets an add-on (+ optional variant); every other
    // category is a ticket line targeting a tier. Exactly one target — mirrors
    // the cart_line_items_target_check DB constraint.
    const isAddon = category === "addon";
    if (isAddon) {
      if (!UUID_RE.test(addonId)) return { error: "Invalid addonId" };
      if (variantId && !UUID_RE.test(variantId)) return { error: "Invalid variantId" };
      if (boundLineItemId && !UUID_RE.test(boundLineItemId)) {
        return { error: "Invalid boundTicketLineItemId" };
      }
    } else {
      if (!UUID_RE.test(tierId)) return { error: "Invalid tierId" };
    }
    if (!Number.isInteger(quantity) || quantity <= 0 || quantity > 20) {
      return { error: "Invalid quantity" };
    }
    if (!Number.isInteger(unitPriceCents) || unitPriceCents < 0) {
      return { error: "Invalid unitPriceCents" };
    }

    lineItems.push({
      lineItemId,
      category: category as LineItemCategory,
      tierId: isAddon ? null : tierId,
      addonId: isAddon ? addonId : null,
      variantId: isAddon && variantId ? variantId : null,
      boundLineItemId: isAddon && boundLineItemId ? boundLineItemId : null,
      quantity,
      unitPriceCents,
      attendees: raw.attendees,
      metadata,
    });
  }

  // Per-ticket bound add-ons must point at a ticket line in the SAME cart.
  for (const item of lineItems) {
    if (
      item.boundLineItemId &&
      !lineItems.some(
        (other) =>
          other.lineItemId === item.boundLineItemId && other.tierId !== null,
      )
    ) {
      return { error: "boundTicketLineItemId must reference a ticket line" };
    }
  }

  return { cartId, eventId, idempotencyKey, lineItems, unlockCodes };
}

function errorFromRpc(result: Record<string, unknown>): Response {
  const error = String(result.error || "hold_failed");
  const status =
    error === "cart_not_found"
      ? 404
      : error === "insufficient_capacity" ||
          error === "addon_insufficient_capacity" ||
          error === "cart_completed"
        ? 409
        : 400;

  return jsonResponse(
    {
      error,
      tierId: result.tierId,
      lineItemId: result.lineItemId,
      available: result.available,
      // Add-on loop errors (20260613000200+): never includes unlock_code.
      addonId: result.addonId,
      variantId: result.variantId,
      requiresTierId: result.requiresTierId,
    },
    status,
  );
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return optionsResponse();
  if (req.method !== "POST") return errorResponse("Method not allowed", 405);

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` } },
    });

    const authId = await verifySession(supabase, req);
    if (!authId) return errorResponse("Unauthorized", 401);

    let parsed: unknown;
    try {
      parsed = await req.json();
    } catch {
      return errorResponse("Invalid JSON", 400);
    }

    const body = validateBody(parsed);
    if ("error" in body) return errorResponse(body.error, 400);

    console.log("[cart-create-hold] hold create requested", {
      cartId: body.cartId,
      eventId: body.eventId,
      userId: authId,
      lineItems: body.lineItems.length,
    });

    const { data: existingCart, error: existingCartError } = await supabase
      .from("carts")
      .select("id, user_id, status")
      .eq("id", body.cartId)
      .maybeSingle();

    if (existingCartError) {
      console.error(
        "[cart-create-hold] existing cart lookup failed",
        existingCartError,
      );
      return errorResponse("Could not load cart", 500);
    }
    if (existingCart && existingCart.user_id !== authId) {
      return errorResponse("Cart not found", 404);
    }
    if (existingCart?.status === "completed") {
      return errorResponse("Cart already completed", 409);
    }

    const { error: cartUpsertError } = await supabase.from("carts").upsert(
      {
        id: body.cartId,
        user_id: authId,
        event_id: body.eventId,
        status: "draft",
        currency: "usd",
        idempotency_key: body.idempotencyKey,
      },
      { onConflict: "id" },
    );

    if (cartUpsertError) {
      console.error("[cart-create-hold] cart upsert failed", cartUpsertError);
      return errorResponse("Could not save cart", 500);
    }

    const { error: releaseExistingHoldsError } = await supabase
      .from("cart_holds")
      .update({ released: true, released_at: new Date().toISOString() })
      .eq("cart_id", body.cartId)
      .eq("released", false);

    if (releaseExistingHoldsError) {
      console.error(
        "[cart-create-hold] existing hold release failed",
        releaseExistingHoldsError,
      );
      return errorResponse("Could not refresh cart hold", 500);
    }

    const { error: deleteLineItemsError } = await supabase
      .from("cart_line_items")
      .delete()
      .eq("cart_id", body.cartId);

    if (deleteLineItemsError) {
      console.error(
        "[cart-create-hold] line item replacement failed",
        deleteLineItemsError,
      );
      return errorResponse("Could not update cart line items", 500);
    }

    const lineItemRows = body.lineItems.map((item) => ({
      id: item.lineItemId,
      cart_id: body.cartId,
      category: item.category,
      tier_id: item.tierId,
      addon_id: item.addonId,
      variant_id: item.variantId,
      bound_line_item_id: item.boundLineItemId,
      quantity: item.quantity,
      unit_price_cents: item.unitPriceCents,
      metadata: {
        ...item.metadata,
        ...(item.attendees ? { attendees: item.attendees } : {}),
      },
    }));

    const { error: insertLineItemsError } = await supabase
      .from("cart_line_items")
      .insert(lineItemRows);

    if (insertLineItemsError) {
      console.error(
        "[cart-create-hold] line item insert failed",
        insertLineItemsError,
      );
      return errorResponse("Could not save cart line items", 500);
    }

    const { data: rpcResult, error: rpcError } = await supabase.rpc(
      "cart_create_hold",
      {
        p_cart_id: body.cartId,
        p_hold_seconds: 600,
        // v3+ signature (20260806201000): locked tiers unlock by code,
        // compared inside the RPC (case-insensitive, never echoed).
        p_unlock_codes: body.unlockCodes,
      },
    );

    if (rpcError) {
      console.error("[cart-create-hold] hold RPC failed", rpcError);
      return errorResponse("Could not create hold", 500);
    }

    if (!rpcResult?.ok) {
      console.warn("[cart-create-hold] hold rejected", rpcResult);
      return errorFromRpc(rpcResult || {});
    }

    console.log("[cart-create-hold] hold created", {
      cartId: body.cartId,
      holdExpiresAt: rpcResult.holdExpiresAt,
    });

    return jsonResponse({
      ok: true,
      cartId: body.cartId,
      holdExpiresAt: rpcResult.holdExpiresAt,
    });
  } catch (err) {
    console.error("[cart-create-hold] unexpected", err);
    return errorResponse("Internal error", 500);
  }
});
