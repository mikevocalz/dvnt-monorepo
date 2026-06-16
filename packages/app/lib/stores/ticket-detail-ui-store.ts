import { create } from "zustand";

type ActionState = "idle" | "loading" | "success" | "error";
type RefundStep = "idle" | "confirm" | "loading";

interface TicketDetailUIState {
  // Async-generated QR data url (rendered into <img>)
  qrDataUrl: string | null;
  setQrDataUrl: (url: string | null) => void;

  // Transfer dialog + search
  showTransferModal: boolean;
  transferQuery: string;
  transferState: ActionState;
  setShowTransferModal: (open: boolean) => void;
  setTransferQuery: (q: string) => void;
  setTransferState: (s: ActionState) => void;

  // Per-action transient states
  shareState: ActionState;
  cancelingTransfer: boolean;
  refundStep: RefundStep;
  setShareState: (s: ActionState) => void;
  setCancelingTransfer: (v: boolean) => void;
  setRefundStep: (s: RefundStep) => void;

  reset: () => void;
}

/**
 * Transient UI state for the web Ticket Detail screen (Zustand, never useState).
 * Holds the async-generated QR data url, the transfer dialog + its search query,
 * and the per-action loading/success states for share/transfer/cancel/refund.
 */
export const useTicketDetailUIStore = create<TicketDetailUIState>((set) => ({
  qrDataUrl: null,
  setQrDataUrl: (qrDataUrl) => set({ qrDataUrl }),

  showTransferModal: false,
  transferQuery: "",
  transferState: "idle",
  setShowTransferModal: (showTransferModal) => set({ showTransferModal }),
  setTransferQuery: (transferQuery) => set({ transferQuery }),
  setTransferState: (transferState) => set({ transferState }),

  shareState: "idle",
  cancelingTransfer: false,
  refundStep: "idle",
  setShareState: (shareState) => set({ shareState }),
  setCancelingTransfer: (cancelingTransfer) => set({ cancelingTransfer }),
  setRefundStep: (refundStep) => set({ refundStep }),

  reset: () =>
    set({
      qrDataUrl: null,
      showTransferModal: false,
      transferQuery: "",
      transferState: "idle",
      shareState: "idle",
      cancelingTransfer: false,
      refundStep: "idle",
    }),
}));
