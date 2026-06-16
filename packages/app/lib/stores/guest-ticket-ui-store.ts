import { create } from "zustand";

type QRLoadState = "idle" | "loading" | "ready" | "error";

interface GuestTicketUIState {
  /** Async-generated QR data url (rendered into <img>). */
  qrDataUrl: string | null;
  /** Lifecycle of the QR generation. */
  qrState: QRLoadState;
  setQr: (url: string | null, state: QRLoadState) => void;
  reset: () => void;
}

/**
 * Transient UI state for the web Guest Ticket screen (Zustand, never useState).
 * Holds only the async-generated QR data url and its load lifecycle — the
 * ticket/event data itself comes from the React Query call to the same
 * `get-guest-ticket` edge function native uses.
 */
export const useGuestTicketUIStore = create<GuestTicketUIState>((set) => ({
  qrDataUrl: null,
  qrState: "idle",
  setQr: (qrDataUrl, qrState) => set({ qrDataUrl, qrState }),
  reset: () => set({ qrDataUrl: null, qrState: "idle" }),
}));
