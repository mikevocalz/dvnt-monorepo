import { create } from "zustand";

interface EventViewState {
  isRsvped: Record<string, boolean>;
  isLiked: Record<string, boolean>;
  ticketCount: Record<string, number>;
  toggleRsvp: (eventId: string) => void;
  toggleLike: (eventId: string) => void;
  setTicketCount: (eventId: string, count: number) => void;
  incrementTickets: (eventId: string) => void;
  decrementTickets: (eventId: string) => void;
}

export const useEventViewStore = create<EventViewState>((set, get) => ({
  isRsvped: {},
  isLiked: {},
  ticketCount: {},
  toggleRsvp: (eventId) =>
    set((state) => ({
      isRsvped: { ...state.isRsvped, [eventId]: !state.isRsvped[eventId] },
    })),
  toggleLike: (eventId) =>
    set((state) => ({
      isLiked: { ...state.isLiked, [eventId]: !state.isLiked[eventId] },
    })),
  setTicketCount: (eventId, count) =>
    set((state) => ({
      ticketCount: { ...state.ticketCount, [eventId]: count },
    })),
  incrementTickets: (eventId) =>
    set((state) => ({
      ticketCount: {
        ...state.ticketCount,
        [eventId]: (state.ticketCount[eventId] || 1) + 1,
      },
    })),
  decrementTickets: (eventId) =>
    set((state) => ({
      ticketCount: {
        ...state.ticketCount,
        [eventId]: Math.max(1, (state.ticketCount[eventId] || 1) - 1),
      },
    })),
}));
