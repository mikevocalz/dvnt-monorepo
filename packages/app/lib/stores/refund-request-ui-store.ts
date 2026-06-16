import { create } from "zustand";
import type { RefundRequest } from "../types/payments";

/**
 * Refund Request form — transient UI state for the web (and any) refund form.
 * Mirrors the native screen-local store in `app/settings/refund-request.tsx`
 * (reason / notes / isSubmitting / submitted) so the data flow is identical:
 * the real `purchasesApi.requestRefund` mutation consumes `reason` + `notes`.
 * Law: state is Zustand, never useState.
 */
export interface RefundRequestUIState {
  reason: RefundRequest["reason"] | null;
  notes: string;
  isSubmitting: boolean;
  submitted: boolean;
  showConfirm: boolean;
  setReason: (reason: RefundRequest["reason"]) => void;
  setNotes: (notes: string) => void;
  setSubmitting: (v: boolean) => void;
  setSubmitted: (v: boolean) => void;
  setShowConfirm: (v: boolean) => void;
  reset: () => void;
}

export const useRefundRequestUIStore = create<RefundRequestUIState>((set) => ({
  reason: null,
  notes: "",
  isSubmitting: false,
  submitted: false,
  showConfirm: false,
  setReason: (reason) => set({ reason }),
  setNotes: (notes) => set({ notes }),
  setSubmitting: (isSubmitting) => set({ isSubmitting }),
  setSubmitted: (submitted) => set({ submitted }),
  setShowConfirm: (showConfirm) => set({ showConfirm }),
  reset: () =>
    set({
      reason: null,
      notes: "",
      isSubmitting: false,
      submitted: false,
      showConfirm: false,
    }),
}));
