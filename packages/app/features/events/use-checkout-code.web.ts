"use client";
import { useEffect, useRef } from "react";
import { invokeEdge } from "@dvnt/app/lib/api/invoke-edge";
import { usePromoterRefStore } from "@dvnt/app/lib/stores/promoter-ref-store";
import { readCheckoutCodeResult, type CheckoutPromo } from "@dvnt/app/lib/payments/checkout-code";

interface CodeField {
  eventId: string; ticketTypeId?: string; scopeId: string;
  enabled: boolean; code: string; applying: boolean;
  setCode: (code: string) => void;
  setPromo: (promo: CheckoutPromo | null) => void;
  setError: (error: string | null) => void;
  setApplying: (applying: boolean) => void;
}
/** Shared by the signed-in event sheet AND mixed-cart review. Validation reads
 * the existing backend; promoter attribution stays in its existing event ref.
 * No claim/account/order/hold is written when Apply is pressed. */
export function useCheckoutCode(field: CodeField) {
  const request = useRef(0);
  const latest = useRef(field);
  latest.current = field;
  const { eventId, ticketTypeId, scopeId, enabled, code, setApplying, setError } = field;
  useEffect(() => {
    request.current++;
    setApplying(false);
    setError(null);
    return () => { request.current++; };
  }, [eventId, ticketTypeId, scopeId, enabled, code, setApplying, setError]);
  useEffect(() => { latest.current.setPromo(null); }, [eventId, ticketTypeId, scopeId]);

  return async () => {
    if (!field.enabled || field.applying) return;
    const normalized = field.code.trim();
    if (!normalized) { field.setError("Enter a promo or promoter code."); return; }
    const version = ++request.current;
    const current = () => version === request.current && latest.current.enabled &&
      latest.current.eventId === field.eventId && latest.current.ticketTypeId === field.ticketTypeId &&
      latest.current.scopeId === field.scopeId && latest.current.code === field.code;
    field.setApplying(true);
    field.setError(null);
    try {
      const { data, error } = await invokeEdge<unknown>("validate-promo-code", {
        event_id: Number(field.eventId), code: normalized,
        ...(field.ticketTypeId ? { ticket_type_id: field.ticketTypeId } : {}),
        accept_promoter: true,
      });
      if (!current()) return;
      if (error) throw new Error(error.message);
      const result = readCheckoutCodeResult(data);
      if (result.kind === "error") throw new Error(result.message);
      if (result.kind === "promoter") {
        // NEVER send this code as promoCode/promo_code: those are another
        // table and would reject it (or apply an unrelated second discount).
        usePromoterRefStore.getState().setRef(field.eventId, result.code, result.customerDiscountBps);
        field.setPromo(null);
        field.setCode("");
      } else { field.setPromo(result.promo); }
    } catch (error) {
      if (current()) {
        field.setPromo(null);
        field.setError(error instanceof Error ? error.message : "Could not check the code. Please try again.");
      }
    } finally { if (version === request.current) field.setApplying(false); }
  };
}
