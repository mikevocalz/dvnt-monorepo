/**
 * Guest paid-checkout sheet state (Phase 5.6.3). Collects buyer email/name/qty
 * for a tier, then guest-checkout returns a hosted Stripe URL we redirect to.
 * Zustand, no useState (matches the other event-detail UI stores).
 */
import { create } from "zustand";

interface GuestCheckoutState {
  open: boolean;
  eventId: string;
  eventTitle: string;
  tierId: string;
  tierName: string;
  priceCents: number;
  email: string;
  name: string;
  quantity: number;
  attendeeNames: string[];
  /** off | optional | required — fetched from the event when the sheet opens. */
  nameRequirement: string;
  refundPolicy: string;
  refundDaysBefore: number | null;
  loading: boolean;
  error: string | null;

  openSheet: (args: {
    eventId: string;
    eventTitle: string;
    tierId: string;
    tierName: string;
    priceCents: number;
  }) => void;
  close: () => void;
  patch: (p: Partial<GuestCheckoutState>) => void;
  setAttendeeName: (i: number, v: string) => void;
}

const base = {
  open: false,
  eventId: "",
  eventTitle: "",
  tierId: "",
  tierName: "",
  priceCents: 0,
  email: "",
  name: "",
  quantity: 1,
  attendeeNames: [] as string[],
  nameRequirement: "off",
  refundPolicy: "before_event",
  refundDaysBefore: null as number | null,
  loading: false,
  error: null as string | null,
};

export const useGuestCheckoutStore = create<GuestCheckoutState>((set) => ({
  ...base,
  openSheet: (a) => set({ ...base, open: true, ...a }),
  close: () => set({ open: false }),
  patch: (p) => set(p),
  setAttendeeName: (i, v) =>
    set((s) => {
      const names = [...s.attendeeNames];
      names[i] = v;
      return { attendeeNames: names };
    }),
}));
