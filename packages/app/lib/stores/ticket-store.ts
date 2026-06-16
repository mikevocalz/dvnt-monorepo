import { create } from "zustand";

export type TicketStatus =
  | "valid"
  | "checked_in"
  | "revoked"
  | "expired"
  | "transfer_pending";
export type TicketTierLevel = "free" | "ga" | "vip" | "table";

export interface Ticket {
  id: string;
  eventId: string;
  userId: string;
  paid: boolean;
  status: TicketStatus;
  checkedInAt?: string;
  qrToken: string;
  qrSvg?: string;
  qrPngUrl?: string;
  applePassUrl?: string;
  googlePassUrl?: string;
  // Tier & access info
  tier?: TicketTierLevel;
  tierName?: string;
  tableNumber?: string;
  transferable?: boolean;
  promoter?: string;
  // Event snapshot (denormalized for offline access)
  eventTitle?: string;
  eventDate?: string;
  eventEndDate?: string;
  eventLocation?: string;
  eventImage?: string;
  dressCode?: string;
  doorPolicy?: string;
  entryWindow?: string;
  perks?: string[];
}

interface TicketStore {
  tickets: Record<string, Ticket>;
  setTicket: (eventId: string, ticket: Ticket) => void;
  getTicketByEventId: (eventId: string) => Ticket | undefined;
  clearTicket: (eventId: string) => void;
  hasValidTicket: (eventId: string) => boolean;
}


export const useTicketStore = create<TicketStore>((set, get) => ({
  tickets: {},

  setTicket: (eventId, ticket) =>
    set((state) => ({
      tickets: { ...state.tickets, [eventId]: ticket },
    })),

  getTicketByEventId: (eventId) => get().tickets[eventId],

  clearTicket: (eventId) =>
    set((state) => {
      const { [eventId]: _, ...rest } = state.tickets;
      return { tickets: rest };
    }),

  hasValidTicket: (eventId) => {
    const ticket = get().tickets[eventId];
    return ticket ? ticket.status === "valid" : false;
  },
}));
