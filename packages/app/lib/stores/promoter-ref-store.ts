/**
 * Promoter-ref store (WS-4 promoter economy).
 *
 * A tracked share link lands with `?ref=CODE` on the event URL
 * (`?promo=` is taken by promo codes). We stash the code per event so
 * it survives navigation AND the app-switch to Stripe's hosted page /
 * PaymentSheet — hence MMKV-persisted (localStorage on web via the
 * shared mmkvStorage adapter). The checkout API layer reads the
 * pending ref at kickoff and forwards it as `promoter_code`; signed-in
 * buyers also persist the claim server-side so it survives login/device
 * changes. The server validates the current promoter policy, applies the
 * customer discount, and records attribution when the order flips paid.
 *
 * Zustand + persist, never useState (house law).
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { mmkvStorage } from "@dvnt/app/lib/mmkv-zustand";

/** Refs older than this are ignored (and pruned on write). */
const REF_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

const CODE_RE = /^[A-Z0-9_-]{2,32}$/;

interface PendingRef {
  code: string;
  capturedAt: number;
  /** Validated buyer discount from the server, in basis points. */
  customerDiscountBps?: number | null;
}

interface PromoterRefState {
  /** eventId (string) → pending promoter code. Last click wins. */
  refs: Record<string, PendingRef>;
  /** Normalize + store a ref for an event. Invalid shapes are dropped. */
  setRef: (
    eventId: string | number,
    rawCode: string,
    customerDiscountBps?: number | null,
  ) => void;
  /** Valid (unexpired) code for an event, or null. */
  getRef: (eventId: string | number) => string | null;
  clearRef: (eventId: string | number) => void;
}

export const usePromoterRefStore = create<PromoterRefState>()(
  persist(
    (set, get) => ({
      refs: {},

      setRef: (eventId, rawCode, customerDiscountBps) => {
        const key = String(eventId);
        const code = String(rawCode || "")
          .trim()
          .toUpperCase()
          .slice(0, 32);
        if (!key || !CODE_RE.test(code)) return;
        const now = Date.now();
        set((s) => {
          // Prune expired refs while we're here.
          const refs: Record<string, PendingRef> = {};
          for (const [k, v] of Object.entries(s.refs)) {
            if (now - v.capturedAt < REF_TTL_MS) refs[k] = v;
          }
          const previous = s.refs[key];
          const validatedBps =
            Number.isInteger(customerDiscountBps) &&
              Number(customerDiscountBps) >= 0 &&
              Number(customerDiscountBps) <= 10000
              ? Number(customerDiscountBps)
              : previous?.code === code
                ? previous.customerDiscountBps ?? null
                : null;
          refs[key] = {
            code,
            capturedAt: now,
            customerDiscountBps: validatedBps,
          };
          return { refs };
        });
      },

      getRef: (eventId) => {
        const entry = get().refs[String(eventId)];
        if (!entry) return null;
        if (Date.now() - entry.capturedAt >= REF_TTL_MS) return null;
        return entry.code;
      },

      clearRef: (eventId) => {
        const key = String(eventId);
        set((s) => {
          if (!s.refs[key]) return s;
          const refs = { ...s.refs };
          delete refs[key];
          return { refs };
        });
      },
    }),
    {
      name: "promoter-ref-storage",
      storage: mmkvStorage,
    },
  ),
);

/** Non-hook read for API-layer call sites (checkout kickoff). */
export function getPendingPromoterRef(
  eventId: string | number,
): string | null {
  return usePromoterRefStore.getState().getRef(eventId);
}
