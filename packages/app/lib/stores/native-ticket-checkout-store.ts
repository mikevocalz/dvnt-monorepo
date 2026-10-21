import { create } from "zustand";
import { persist } from "zustand/middleware";
import { mmkvStorage } from "@dvnt/app/lib/mmkv-zustand";
import type { PendingNativeTicketCheckout } from "@dvnt/app/lib/tickets/native-checkout-outcome";

export function nativeTicketCheckoutKey(
  viewerId: string,
  eventId: string,
): string {
  return JSON.stringify([viewerId, eventId]);
}

interface NativeTicketCheckoutState {
  pending: Record<string, PendingNativeTicketCheckout>;
  remember: (key: string, purchase: PendingNativeTicketCheckout) => void;
  clear: (key: string) => void;
}

/**
 * Survives screen teardown and app restarts. Account-scoped purchase references
 * are not credentials; only the server's ticket query can supply a pass.
 * No timeout clears an uncertain purchase and silently enables another charge.
 */
export const useNativeTicketCheckoutStore = create<NativeTicketCheckoutState>()(
  persist(
    (set) => ({
      pending: {},
      remember: (key, purchase) =>
        set((state) => ({ pending: { ...state.pending, [key]: purchase } })),
      clear: (key) =>
        set((state) => {
          const pending = { ...state.pending };
          delete pending[key];
          return { pending };
        }),
    }),
    { name: "native-ticket-checkout-pending", storage: mmkvStorage },
  ),
);
