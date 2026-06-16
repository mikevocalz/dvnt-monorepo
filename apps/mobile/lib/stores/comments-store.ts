import { create } from "zustand"

interface CommentsState {
  newComment: string
  replyingTo: string | null
  setNewComment: (text: string) => void
  setReplyingTo: (commentId: string | null) => void
  clearComment: () => void
}

export const useCommentsStore = create<CommentsState>((set) => ({
  newComment: "",
  replyingTo: null,
  setNewComment: (text) => set({ newComment: text }),
  setReplyingTo: (commentId) => set({ replyingTo: commentId }),
  clearComment: () => set({ newComment: "", replyingTo: null }),
}))

interface StoryViewerState {
  currentStoryId: string
  currentItemIndex: number
  setCurrentStoryId: (id: string) => void
  setCurrentItemIndex: (index: number) => void
  nextItem: (maxItems: number) => boolean
  prevItem: () => boolean
  reset: () => void
}

export const useStoryViewerStore = create<StoryViewerState>((set, get) => ({
  currentStoryId: "",
  currentItemIndex: 0,
  setCurrentStoryId: (id) => set({ currentStoryId: id, currentItemIndex: 0 }),
  setCurrentItemIndex: (index) => set({ currentItemIndex: index }),
  nextItem: (maxItems) => {
    const { currentItemIndex } = get()
    if (currentItemIndex < maxItems - 1) {
      set({ currentItemIndex: currentItemIndex + 1 })
      return true
    }
    return false
  },
  prevItem: () => {
    const { currentItemIndex } = get()
    if (currentItemIndex > 0) {
      set({ currentItemIndex: currentItemIndex - 1 })
      return true
    }
    return false
  },
  reset: () => set({ currentStoryId: "", currentItemIndex: 0 }),
}))

interface NewMessageState {
  searchQuery: string
  selectedUsers: string[]
  setSearchQuery: (query: string) => void
  toggleUser: (userId: string) => void
  clearSelection: () => void
  reset: () => void
}

export const useNewMessageStore = create<NewMessageState>((set, get) => ({
  searchQuery: "",
  selectedUsers: [],
  setSearchQuery: (query) => set({ searchQuery: query }),
  toggleUser: (userId) => {
    const { selectedUsers } = get()
    if (selectedUsers.includes(userId)) {
      set({ selectedUsers: selectedUsers.filter(id => id !== userId) })
    } else {
      set({ selectedUsers: [...selectedUsers, userId] })
    }
  },
  clearSelection: () => set({ selectedUsers: [] }),
  reset: () => set({ searchQuery: "", selectedUsers: [] }),
}))
