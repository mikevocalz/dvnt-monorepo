import { create } from "zustand";

/**
 * Web event-detail UI state. Zustand, not useState. Drives the menu popover
 * plus the checkout sheet, review composer, translation toggle, upgrade sheet,
 * and promo-code field — every transient flag the event-detail web screen
 * needs to reach parity with the native source.
 */
interface EventDetailUiState {
  // ⋯ header menu popover
  menuOpen: boolean;
  setMenuOpen: (open: boolean) => void;

  // Ticket checkout sheet
  checkoutOpen: boolean;
  setCheckoutOpen: (open: boolean) => void;
  selectedTierId: string | null;
  setSelectedTierId: (id: string | null) => void;
  ticketQty: number;
  setTicketQty: (qty: number) => void;
  promoCode: string;
  setPromoCode: (code: string) => void;
  // Validated promo result (for the checkout sheet's discount line). The server
  // re-validates at charge; this only drives the buyer-facing display.
  appliedPromo: {
    type: "percent" | "fixed_cents" | "bogo";
    value: number;
    code: string;
  } | null;
  setAppliedPromo: (
    p: { type: "percent" | "fixed_cents" | "bogo"; value: number; code: string } | null,
  ) => void;
  promoError: string | null;
  setPromoError: (e: string | null) => void;
  promoApplying: boolean;
  setPromoApplying: (v: boolean) => void;

  // Upgrade confirmation sheet — holds the tier id being upgraded to
  upgradeTierId: string | null;
  setUpgradeTierId: (id: string | null) => void;

  // Write-a-review dialog
  reviewOpen: boolean;
  setReviewOpen: (open: boolean) => void;
  reviewRating: number;
  setReviewRating: (rating: number) => void;
  reviewText: string;
  setReviewText: (text: string) => void;

  // Translation toggle
  translated: boolean;
  setTranslated: (v: boolean) => void;

  reset: () => void;
}

export const useEventDetailUiStore = create<EventDetailUiState>((set) => ({
  menuOpen: false,
  setMenuOpen: (menuOpen) => set({ menuOpen }),

  checkoutOpen: false,
  setCheckoutOpen: (checkoutOpen) => set({ checkoutOpen }),
  selectedTierId: null,
  setSelectedTierId: (selectedTierId) => set({ selectedTierId }),
  ticketQty: 1,
  setTicketQty: (ticketQty) => set({ ticketQty: Math.max(1, ticketQty) }),
  promoCode: "",
  setPromoCode: (promoCode) => set({ promoCode }),
  appliedPromo: null,
  setAppliedPromo: (appliedPromo) => set({ appliedPromo }),
  promoError: null,
  setPromoError: (promoError) => set({ promoError }),
  promoApplying: false,
  setPromoApplying: (promoApplying) => set({ promoApplying }),

  upgradeTierId: null,
  setUpgradeTierId: (upgradeTierId) => set({ upgradeTierId }),

  reviewOpen: false,
  setReviewOpen: (reviewOpen) => set({ reviewOpen }),
  reviewRating: 5,
  setReviewRating: (reviewRating) => set({ reviewRating }),
  reviewText: "",
  setReviewText: (reviewText) => set({ reviewText }),

  translated: false,
  setTranslated: (translated) => set({ translated }),

  reset: () =>
    set({
      menuOpen: false,
      checkoutOpen: false,
      selectedTierId: null,
      ticketQty: 1,
      promoCode: "",
      appliedPromo: null,
      promoError: null,
      promoApplying: false,
      upgradeTierId: null,
      reviewOpen: false,
      reviewRating: 5,
      reviewText: "",
      translated: false,
    }),
}));
