import { create } from "zustand";

/** One playable segment within a user's story group. */
export interface StoryViewerSegment {
  type: "image" | "video";
  url: string;
  duration?: number;
}

/** A user's story (a group of segments) as fed to the full-screen viewer. */
export interface StoryViewerGroup {
  id: string;
  username: string;
  avatar: string;
  segments: StoryViewerSegment[];
}

interface StoryViewerState {
  open: boolean;
  groups: StoryViewerGroup[];
  /** Index of the user-group currently playing. */
  groupIndex: number;
  openAt: (groups: StoryViewerGroup[], groupIndex: number) => void;
  close: () => void;
  /** Advance to the next user-group; closes after the last. */
  nextGroup: () => void;
}

export const useStoryViewerStore = create<StoryViewerState>((set, get) => ({
  open: false,
  groups: [],
  groupIndex: 0,
  openAt: (groups, groupIndex) => set({ open: true, groups, groupIndex }),
  close: () => set({ open: false, groups: [], groupIndex: 0 }),
  nextGroup: () => {
    const { groupIndex, groups } = get();
    if (groupIndex + 1 >= groups.length) set({ open: false, groups: [], groupIndex: 0 });
    else set({ groupIndex: groupIndex + 1 });
  },
}));
