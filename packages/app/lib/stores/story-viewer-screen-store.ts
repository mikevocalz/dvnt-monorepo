/**
 * Story Viewer Screen Store
 * 
 * Zustand store for story viewer screen ephemeral UI state.
 * Replaces useState calls to comply with project mandate.
 */

import { create } from "zustand";

interface StoryTag {
  id: string;
  username: string;
  x: number;
  y: number;
}

interface FloatingEmoji {
  id: number;
  emoji: string;
}

interface StoryViewerScreenState {
  // Video controls
  showSeekBar: boolean;
  videoCurrentTime: number;
  videoDuration: number;
  
  // Reply state
  replyText: string;
  isSendingReply: boolean;
  isInputFocused: boolean;
  
  // User resolution
  resolvedUserId: string | null;
  
  // Tags
  storyTags: StoryTag[];
  showTags: boolean;
  
  // Floating emojis
  floatingEmojis: FloatingEmoji[];
  
  // Viewers sheet
  showViewersSheet: boolean;
  
  // Actions
  setShowSeekBar: (show: boolean) => void;
  setVideoCurrentTime: (time: number) => void;
  setVideoDuration: (duration: number) => void;
  setReplyText: (text: string) => void;
  setIsSendingReply: (sending: boolean) => void;
  setIsInputFocused: (focused: boolean) => void;
  setResolvedUserId: (userId: string | null) => void;
  setStoryTags: (tags: StoryTag[]) => void;
  setShowTags: (show: boolean) => void;
  setFloatingEmojis: (emojis: FloatingEmoji[]) => void;
  addFloatingEmoji: (emoji: FloatingEmoji) => void;
  removeFloatingEmoji: (id: number) => void;
  setShowViewersSheet: (show: boolean) => void;
  
  // Reset all state when leaving screen
  resetStoryViewerScreen: () => void;
}

const initialState = {
  showSeekBar: false,
  videoCurrentTime: 0,
  videoDuration: 0,
  replyText: "",
  isSendingReply: false,
  isInputFocused: false,
  resolvedUserId: null,
  storyTags: [],
  showTags: false,
  floatingEmojis: [],
  showViewersSheet: false,
};

export const useStoryViewerScreenStore = create<StoryViewerScreenState>((set) => ({
  ...initialState,

  setShowSeekBar: (show) => set({ showSeekBar: show }),
  setVideoCurrentTime: (time) => set({ videoCurrentTime: time }),
  setVideoDuration: (duration) => set({ videoDuration: duration }),
  setReplyText: (text) => set({ replyText: text }),
  setIsSendingReply: (sending) => set({ isSendingReply: sending }),
  setIsInputFocused: (focused) => set({ isInputFocused: focused }),
  setResolvedUserId: (userId) => set({ resolvedUserId: userId }),
  setStoryTags: (tags) => set({ storyTags: tags }),
  setShowTags: (show) => set({ showTags: show }),
  setFloatingEmojis: (emojis) => set({ floatingEmojis: emojis }),
  addFloatingEmoji: (emoji) => set((state) => ({ 
    floatingEmojis: [...state.floatingEmojis, emoji] 
  })),
  removeFloatingEmoji: (id) => set((state) => ({ 
    floatingEmojis: state.floatingEmojis.filter(e => e.id !== id) 
  })),
  setShowViewersSheet: (show) => set({ showViewersSheet: show }),
  
  resetStoryViewerScreen: () => set(initialState),
}));
