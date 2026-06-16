import { create } from "zustand";

interface VideoState {
  showSeekBar: boolean;
  currentTime: number;
  duration: number;
  isFullscreen: boolean;
}

interface FeedPostUIState {
  pressedPosts: Record<string, boolean>;
  likeAnimatingPosts: Record<string, boolean>;
  videoStates: Record<string, VideoState>;
  previewMedia: { type: "image" | "video"; uri: string } | null;
  showPreviewModal: boolean;
  activePostId: string | null;
  isMuted: boolean;
  actionSheetPostId: string | null;
  shareSheetPostId: string | null;
  commentsSheetPostId: string | null;
  firstPageImagesPrefetched: boolean;

  setPressedPost: (postId: string, pressed: boolean) => void;
  setLikeAnimating: (postId: string, animating: boolean) => void;
  setVideoState: (postId: string, state: Partial<VideoState>) => void;
  getVideoState: (postId: string) => VideoState;
  setPreviewMedia: (
    media: { type: "image" | "video"; uri: string } | null,
  ) => void;
  setShowPreviewModal: (show: boolean) => void;
  resetVideoState: (postId: string) => void;
  setActivePostId: (postId: string | null) => void;
  toggleMute: () => void;
  setActionSheetPostId: (postId: string | null) => void;
  setShareSheetPostId: (postId: string | null) => void;
  setCommentsSheetPostId: (postId: string | null) => void;
  setFirstPageImagesPrefetched: (prefetched: boolean) => void;
  resetImagePrefetch: () => void;
}

const defaultVideoState: VideoState = {
  showSeekBar: false,
  currentTime: 0,
  duration: 0,
  isFullscreen: false,
};

export const useFeedPostUIStore = create<FeedPostUIState>((set, get) => ({
  pressedPosts: {},
  likeAnimatingPosts: {},
  videoStates: {},
  previewMedia: null,
  showPreviewModal: false,
  activePostId: null,
  isMuted: true,
  actionSheetPostId: null,
  shareSheetPostId: null,
  commentsSheetPostId: null,
  firstPageImagesPrefetched: false,

  setPressedPost: (postId, pressed) =>
    set((state) => ({
      pressedPosts: { ...state.pressedPosts, [postId]: pressed },
    })),

  setLikeAnimating: (postId, animating) =>
    set((state) => ({
      likeAnimatingPosts: { ...state.likeAnimatingPosts, [postId]: animating },
    })),

  setVideoState: (postId, newState) =>
    set((state) => ({
      videoStates: {
        ...state.videoStates,
        [postId]: { ...get().getVideoState(postId), ...newState },
      },
    })),

  getVideoState: (postId) => get().videoStates[postId] || defaultVideoState,

  setPreviewMedia: (media) => set({ previewMedia: media }),

  setShowPreviewModal: (show) => set({ showPreviewModal: show }),

  resetVideoState: (postId) =>
    set((state) => ({
      videoStates: { ...state.videoStates, [postId]: defaultVideoState },
    })),

  setActivePostId: (postId) => set({ activePostId: postId }),

  toggleMute: () => set((state) => ({ isMuted: !state.isMuted })),

  setActionSheetPostId: (postId) => set({ actionSheetPostId: postId }),
  setShareSheetPostId: (postId) => set({ shareSheetPostId: postId }),
  setCommentsSheetPostId: (postId) => set({ commentsSheetPostId: postId }),
  setFirstPageImagesPrefetched: (prefetched) =>
    set({ firstPageImagesPrefetched: prefetched }),
  resetImagePrefetch: () => set({ firstPageImagesPrefetched: false }),
}));
