import { create } from "zustand";
import type {
  StoryAnimatedGifOverlay,
  StoryOverlay,
} from "@dvnt/app/lib/types";

/** One playable segment within a user's story group. */
export interface StoryViewerSegment {
  type: "image" | "video";
  url: string;
  duration?: number;
  /** Text / emoji / image-sticker / WS-4 overlays rendered over this segment. */
  storyOverlays?: StoryOverlay[];
  /** Animated-GIF overlays (published as a separate array) for this segment. */
  animatedGifOverlays?: StoryAnimatedGifOverlay[];
}

/** A user's story (a group of segments) as fed to the full-screen viewer. */
export interface StoryViewerGroup {
  id: string;
  username: string;
  userId?: string;
  avatar: string;
  segments: StoryViewerSegment[];
}

interface StoryViewerState {
  open: boolean;
  groups: StoryViewerGroup[];
  /** Index of the user-group currently playing. */
  groupIndex: number;
  /** Suppress the direct-link route's fallback when closing to open a profile/sticker. */
  navigationClose: boolean;
  openAt: (groups: StoryViewerGroup[], groupIndex: number) => void;
  close: () => void;
  closeForNavigation: () => void;
  /** Advance to the next user-group; closes after the last. */
  nextGroup: () => void;
}

export const useStoryViewerStore = create<StoryViewerState>((set, get) => ({
  open: false,
  groups: [],
  groupIndex: 0,
  navigationClose: false,
  openAt: (groups, groupIndex) => set({ open: true, groups, groupIndex, navigationClose: false }),
  close: () => set({ open: false, groups: [], groupIndex: 0, navigationClose: false }),
  closeForNavigation: () => set({ open: false, groups: [], groupIndex: 0, navigationClose: true }),
  nextGroup: () => {
    const { groupIndex, groups } = get();
    if (groupIndex + 1 >= groups.length) set({ open: false, groups: [], groupIndex: 0 });
    else set({ groupIndex: groupIndex + 1 });
  },
}));
