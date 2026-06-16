import { create } from "zustand"

interface TicketModalStore {
  isVisible: boolean
  openModal: () => void
  closeModal: () => void
}

export const useTicketModalStore = create<TicketModalStore>((set) => ({
  isVisible: false,
  openModal: () => set({ isVisible: true }),
  closeModal: () => set({ isVisible: false }),
}))
