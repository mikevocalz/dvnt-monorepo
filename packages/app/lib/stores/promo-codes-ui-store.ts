import { create } from "zustand"

/**
 * Promo Codes screen UI state (web). Project rule: screen-local UI state lives
 * in Zustand, never useState. Mirrors the native promo-codes screen's local
 * controls: the create sheet visibility and the create form draft (code,
 * discount type %/$, value, max uses).
 */
export type PromoDiscountType = "percent" | "fixed_cents"

interface PromoCodesUIState {
  showCreate: boolean
  newCode: string
  discountType: PromoDiscountType
  discountValue: string
  maxUses: string
  setShowCreate: (value: boolean) => void
  setNewCode: (value: string) => void
  setDiscountType: (value: PromoDiscountType) => void
  setDiscountValue: (value: string) => void
  setMaxUses: (value: string) => void
  resetForm: () => void
}

const FORM_DEFAULTS = {
  newCode: "",
  discountType: "percent" as PromoDiscountType,
  discountValue: "",
  maxUses: "",
}

export const usePromoCodesUIStore = create<PromoCodesUIState>((set) => ({
  showCreate: false,
  ...FORM_DEFAULTS,
  setShowCreate: (showCreate) => set({ showCreate }),
  setNewCode: (newCode) => set({ newCode }),
  setDiscountType: (discountType) => set({ discountType }),
  setDiscountValue: (discountValue) => set({ discountValue }),
  setMaxUses: (maxUses) => set({ maxUses }),
  resetForm: () => set({ ...FORM_DEFAULTS }),
}))
