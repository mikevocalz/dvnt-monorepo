/**
 * Guest RSVP sheet state (Phase 5.6.3b) — drives the no-account free-RSVP flow:
 * collect email/name/qty → OTP (rsvp-verify) → issue (rsvp-issue-guest). Zustand,
 * no useState (matches the event-detail UI stores).
 */
import { create } from "zustand";

export type GuestRsvpStep = "form" | "code" | "done";

interface GuestRsvpState {
  open: boolean;
  eventId: string;
  eventTitle: string;
  step: GuestRsvpStep;
  email: string;
  name: string;
  quantity: number;
  attendeeNames: string[];
  /** off | optional | required — fetched when the sheet opens. */
  nameRequirement: string;
  code: string;
  grant: string | null;
  loading: boolean;
  error: string | null;
  resultCount: number;

  openSheet: (eventId: string, eventTitle: string) => void;
  close: () => void;
  patch: (p: Partial<GuestRsvpState>) => void;
  setAttendeeName: (i: number, v: string) => void;
  reset: () => void;
}

const initial = {
  open: false,
  eventId: "",
  eventTitle: "",
  step: "form" as GuestRsvpStep,
  email: "",
  name: "",
  quantity: 1,
  attendeeNames: [] as string[],
  nameRequirement: "off",
  code: "",
  grant: null as string | null,
  loading: false,
  error: null as string | null,
  resultCount: 0,
};

export const useGuestRsvpStore = create<GuestRsvpState>((set) => ({
  ...initial,
  openSheet: (eventId, eventTitle) =>
    set({ ...initial, open: true, eventId, eventTitle }),
  close: () => set({ open: false }),
  patch: (p) => set(p),
  setAttendeeName: (i, v) =>
    set((s) => {
      const names = [...s.attendeeNames];
      names[i] = v;
      return { attendeeNames: names };
    }),
  reset: () => set(initial),
}));
