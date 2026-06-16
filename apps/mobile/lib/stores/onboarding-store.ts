import { create } from "zustand"

interface OnboardingState {
  currentIndex: number
  setCurrentIndex: (index: number) => void
  nextPage: () => void
  prevPage: () => void
  reset: () => void
}

const TOTAL_PAGES = 4

export const useOnboardingStore = create<OnboardingState>((set, get) => ({
  currentIndex: 0,
  setCurrentIndex: (index) => set({ currentIndex: index }),
  nextPage: () => {
    const current = get().currentIndex
    if (current < TOTAL_PAGES - 1) {
      set({ currentIndex: current + 1 })
    }
  },
  prevPage: () => {
    const current = get().currentIndex
    if (current > 0) {
      set({ currentIndex: current - 1 })
    }
  },
  reset: () => set({ currentIndex: 0 }),
}))
