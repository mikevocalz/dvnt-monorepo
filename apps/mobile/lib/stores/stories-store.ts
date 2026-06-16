import { create } from "zustand"

interface StoriesState {
  isViewerOpen: boolean
  currentStoryIndex: number
  openViewer: (index: number) => void
  closeViewer: () => void
  setCurrentIndex: (index: number) => void
}

export const useStoriesStore = create<StoriesState>((set) => ({
  isViewerOpen: false,
  currentStoryIndex: 0,
  openViewer: (index) => set({ isViewerOpen: true, currentStoryIndex: index }),
  closeViewer: () => set({ isViewerOpen: false }),
  setCurrentIndex: (index) => set({ currentStoryIndex: index }),
}))
