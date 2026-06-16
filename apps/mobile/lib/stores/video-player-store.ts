import { create } from "zustand";

interface VideoPlayerState {
  currentTime: number;
  duration: number;
  isMuted: boolean;
  isPlaying: boolean;
  isFullscreen: boolean;
  setCurrentTime: (time: number) => void;
  setDuration: (duration: number) => void;
  setIsMuted: (muted: boolean) => void;
  setIsPlaying: (playing: boolean) => void;
  setIsFullscreen: (fullscreen: boolean) => void;
  reset: () => void;
}

interface VideoPlayerStateMulti {
  players: Record<
    string,
    {
      currentTime: number;
      duration: number;
      isMuted: boolean;
      isPlaying: boolean;
      isFullscreen: boolean;
    }
  >;
  setCurrentTime: (postId: string, time: number) => void;
  setDuration: (postId: string, duration: number) => void;
  setIsMuted: (postId: string, muted: boolean) => void;
  setIsPlaying: (postId: string, playing: boolean) => void;
  setIsFullscreen: (postId: string, fullscreen: boolean) => void;
  reset: (postId: string) => void;
  getPlayer: (postId: string) => {
    currentTime: number;
    duration: number;
    isMuted: boolean;
    isPlaying: boolean;
    isFullscreen: boolean;
  };
}

const initialState = {
  currentTime: 0,
  duration: 0,
  isMuted: false,
  isPlaying: true,
  isFullscreen: false,
};

// Single instance store for PostDetail
export const useVideoPlayerStore = create<VideoPlayerState>((set) => ({
  ...initialState,
  setCurrentTime: (time) => set({ currentTime: time }),
  setDuration: (duration) => set({ duration }),
  setIsMuted: (muted) => set({ isMuted: muted }),
  setIsPlaying: (playing) => set({ isPlaying: playing }),
  setIsFullscreen: (fullscreen) => set({ isFullscreen: fullscreen }),
  reset: () => set(initialState),
}));

// Multi-instance store for Feed posts (keyed by postId)
export const useVideoPlayerStoreMulti = create<VideoPlayerStateMulti>(
  (set, get) => ({
    players: {},
    setCurrentTime: (postId, time) =>
      set((state) => ({
        players: {
          ...state.players,
          [postId]: {
            ...(state.players[postId] || initialState),
            currentTime: time,
          },
        },
      })),
    setDuration: (postId, duration) =>
      set((state) => ({
        players: {
          ...state.players,
          [postId]: { ...(state.players[postId] || initialState), duration },
        },
      })),
    setIsMuted: (postId, muted) =>
      set((state) => ({
        players: {
          ...state.players,
          [postId]: {
            ...(state.players[postId] || initialState),
            isMuted: muted,
          },
        },
      })),
    setIsPlaying: (postId, playing) =>
      set((state) => ({
        players: {
          ...state.players,
          [postId]: {
            ...(state.players[postId] || initialState),
            isPlaying: playing,
          },
        },
      })),
    setIsFullscreen: (postId, fullscreen) =>
      set((state) => ({
        players: {
          ...state.players,
          [postId]: {
            ...(state.players[postId] || initialState),
            isFullscreen: fullscreen,
          },
        },
      })),
    reset: (postId) =>
      set((state) => ({
        players: {
          ...state.players,
          [postId]: initialState,
        },
      })),
    getPlayer: (postId) => {
      const players = get().players;
      return players[postId] || initialState;
    },
  }),
);
