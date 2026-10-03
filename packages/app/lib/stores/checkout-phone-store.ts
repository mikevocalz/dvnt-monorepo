/**
 * The phone a signed-in buyer types after checkout asks for one. `needed`
 * flips on when a checkout function answers phone_required, which shows the
 * field in the checkout sheet (native) and on the review screen (web and
 * native cart). Cleared after a checkout that got past the check.
 */
import { create } from "zustand";
import { phoneForRequest } from "@dvnt/app/lib/checkout/member-phone";

interface CheckoutPhoneState {
  needed: boolean;
  phone: string;
  setPhone: (value: string) => void;
  markNeeded: () => void;
  reset: () => void;
  /** The phone to send, or the message to show instead of sending. */
  forRequest: () => ReturnType<typeof phoneForRequest>;
}

export const useCheckoutPhoneStore = create<CheckoutPhoneState>((set, get) => ({
  needed: false,
  phone: "",
  setPhone: (phone) => set({ phone }),
  markNeeded: () => set({ needed: true }),
  reset: () => set({ needed: false, phone: "" }),
  forRequest: () => phoneForRequest(get().needed, get().phone),
}));
