import { create } from "zustand"

interface FAQState {
  expandedIndex: number | null
  setExpandedIndex: (index: number | null) => void
  toggleExpanded: (index: number) => void
}

export const useFAQStore = create<FAQState>((set, get) => ({
  expandedIndex: null,
  setExpandedIndex: (index) => set({ expandedIndex: index }),
  toggleExpanded: (index) => {
    const current = get().expandedIndex
    set({ expandedIndex: current === index ? null : index })
  },
}))
