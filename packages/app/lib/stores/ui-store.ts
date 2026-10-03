import { create } from "zustand"
import { toast } from "sonner-native"
import { dispatchToast } from "../toast/dispatch"
import { webToastHost } from "../toast/web-host"

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

  // Unified toast. sonner-native first (native mounts its <Toaster>), then
  // sonner on web, where Next mounts sonner's <Toaster> instead and
  // sonner-native throws "ToastContext is not initialized".
  // MUST be non-throwing: on web, some ssr:false standalone routes (the
  // Sneaky Lynk create/room screens) render outside any Toaster. A throw there
  // aborted handleCreate before router.push. A toast must never break its caller.
  showToast: (type, title, description) => {
    if (!dispatchToast([toast, webToastHost], type, title, description)) {
      if (typeof console !== 'undefined') {
        console.warn(`[toast:${type}] ${title}${description ? ` — ${description}` : ''}`)
      }
    }
  },

  dismissToast: (id) =>
    set((state) => ({
      toasts: state.toasts.filter((t) => t.id !== id),
    })),

  clearToasts: () => set({ toasts: [] }),
  
  setShowActionSheet: (show) => set({ showActionSheet: show }),
}))
