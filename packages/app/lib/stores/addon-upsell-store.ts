/**
 * Add-on upsell selection — transient Zustand store shared by the buyer
 * surfaces (event-detail checkout sheet, checkout review, post-purchase
 * upsell on ticket-upgrade / ticket-detail). NOT persisted: the durable cart
 * is `useCartStore`; this only tracks what the buyer is picking BEFORE the
 * selections become cart line items. Client shows prices for preview only —
 * the server (cart_create_hold) recomputes every unit price under lock.
 */

import { create } from "zustand";

export interface AddonSelection {
  addonId: string;
  /** null = the add-on itself (no variant matrix, or matrix collapsed). */
  variantId: string | null;
  quantity: number;
}

export function addonSelectionKey(
  addonId: string,
  variantId: string | null,
): string {
  return variantId ? `${addonId}:${variantId}` : addonId;
}

interface AddonUpsellState {
  /** Event these selections belong to — switching events clears them. */
  eventId: string | null;
  selections: Record<string, AddonSelection>;
  /** Which add-on card has its variant matrix expanded (web + native UI). */
  expandedAddonId: string | null;

  setQuantity: (
    eventId: string,
    addonId: string,
    variantId: string | null,
    quantity: number,
  ) => void;
  increment: (eventId: string, addonId: string, variantId: string | null) => void;
  decrement: (eventId: string, addonId: string, variantId: string | null) => void;
  setExpandedAddonId: (addonId: string | null) => void;
  selectionList: () => AddonSelection[];
  totalSelectedQty: () => number;
  reset: () => void;
}

export const useAddonUpsellStore = create<AddonUpsellState>((set, get) => ({
  eventId: null,
  selections: {},
  expandedAddonId: null,

  setQuantity: (eventId, addonId, variantId, quantity) =>
    set((s) => {
      const base = s.eventId === eventId ? s.selections : {};
      const key = addonSelectionKey(addonId, variantId);
      const next = { ...base };
      if (quantity <= 0) {
        delete next[key];
      } else {
        next[key] = { addonId, variantId, quantity: Math.min(quantity, 20) };
      }
      return { eventId, selections: next };
    }),

  increment: (eventId, addonId, variantId) => {
    const key = addonSelectionKey(addonId, variantId);
    const current =
      get().eventId === eventId ? (get().selections[key]?.quantity ?? 0) : 0;
    get().setQuantity(eventId, addonId, variantId, current + 1);
  },

  decrement: (eventId, addonId, variantId) => {
    const key = addonSelectionKey(addonId, variantId);
    const current =
      get().eventId === eventId ? (get().selections[key]?.quantity ?? 0) : 0;
    get().setQuantity(eventId, addonId, variantId, current - 1);
  },

  setExpandedAddonId: (expandedAddonId) => set({ expandedAddonId }),

  selectionList: () => Object.values(get().selections),

  totalSelectedQty: () =>
    Object.values(get().selections).reduce((sum, s) => sum + s.quantity, 0),

  reset: () => set({ eventId: null, selections: {}, expandedAddonId: null }),
}));
