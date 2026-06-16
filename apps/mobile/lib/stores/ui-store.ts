import { create } from "zustand"
import { toast } from "sonner-native"

type ScreenName = 
  | "profile" 
  | "activity" 
  | "events" 
  | "search" 
  | "messages" 
  | "chat" 
  | "postDetail"
  | "userProfile"
  | "stories"

type ToastType = 'success' | 'error' | 'info' | 'warning'

interface Toast {
  id: string
  type: ToastType
  title: string
  description?: string
}

interface UIState {
  loadingScreens: Record<ScreenName, boolean>
  searchingState: boolean
  toasts: Toast[]
  showActionSheet: boolean
  
  setScreenLoading: (screen: ScreenName, loading: boolean) => void
  setSearching: (searching: boolean) => void
  isScreenLoading: (screen: ScreenName) => boolean
  resetScreenLoading: (screen: ScreenName) => void
  showToast: (type: ToastType, title: string, description?: string) => void
  dismissToast: (id: string) => void
  clearToasts: () => void
  setShowActionSheet: (show: boolean) => void
}

export const useUIStore = create<UIState>((set, get) => ({
  loadingScreens: {
    profile: true,
    activity: true,
    events: true,
    search: true,
    messages: true,
    chat: true,
    postDetail: true,
    userProfile: true,
    stories: true,
  },
  searchingState: false,
  toasts: [],
  showActionSheet: false,

  setScreenLoading: (screen, loading) =>
    set((state) => ({
      loadingScreens: { ...state.loadingScreens, [screen]: loading },
    })),

  setSearching: (searching) => set({ searchingState: searching }),

  isScreenLoading: (screen) => get().loadingScreens[screen] ?? true,

  resetScreenLoading: (screen) =>
    set((state) => ({
      loadingScreens: { ...state.loadingScreens, [screen]: true },
    })),

  // Unified toast using sonner-native
  showToast: (type, title, description) => {
    const options = { description }
    
    switch (type) {
      case 'success':
        toast.success(title, options)
        break
      case 'error':
        toast.error(title, options)
        break
      case 'warning':
        toast.warning(title, options)
        break
      case 'info':
      default:
        toast.info(title, options)
        break
    }
  },

  dismissToast: (id) =>
    set((state) => ({
      toasts: state.toasts.filter((t) => t.id !== id),
    })),

  clearToasts: () => set({ toasts: [] }),
  
  setShowActionSheet: (show) => set({ showActionSheet: show }),
}))
