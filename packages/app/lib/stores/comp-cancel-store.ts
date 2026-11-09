import { create } from "zustand";
import type { TicketRecord } from "../api/tickets";
interface State {
  ticket: TicketRecord | null;
  reason: string;
  error: string | null;
  busy: boolean;
  generation: number;
  open: (ticket: TicketRecord) => void;
  close: () => void;
  setReason: (reason: string) => void;
}
export const useCompCancelStore = create<State>((set) => ({
  ticket: null,
  reason: "",
  error: null,
  busy: false,
  generation: 0,
  open: (ticket) =>
    set((s) =>
      s.busy
        ? s
        : { ticket, reason: "", error: null, generation: s.generation + 1 },
    ),
  close: () =>
    set((s) =>
      s.busy
        ? s
        : {
            ticket: null,
            reason: "",
            error: null,
            generation: s.generation + 1,
          },
    ),
  setReason: (reason) => set({ reason }),
}));
