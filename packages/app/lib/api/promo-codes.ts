import { invokeEdge } from "./invoke-edge";

/** Authenticated server mutation, independent of the client's PostgREST bridge.
 * The server verifies accepted event roles and owns creator/usage attribution. */
export async function createEventPromoCode(input: {
  eventId: number;
  code: string;
  discountType: "percent" | "fixed_cents";
  discountValue: number;
  maxUses: number | null;
}): Promise<string> {
  const { data, error } = await invokeEdge<{
    ok?: boolean;
    promo?: { id: string; code: string };
    error?: string;
    code?: string;
  }>("manage-promo-code", {
    action: "create",
    event_id: input.eventId,
    code: input.code.trim().toUpperCase(),
    discount_type: input.discountType,
    discount_value: input.discountValue,
    max_uses: input.maxUses,
  });
  if (error || !data?.ok || !data.promo?.id) {
    const failure = new Error(error?.message || data?.error || "Could not create promo code") as Error & { duplicate?: boolean };
    failure.duplicate = error?.status === 409 || error?.code === "promo_code_exists" || data?.code === "promo_code_exists";
    throw failure;
  }
  return data.promo.code;
}
