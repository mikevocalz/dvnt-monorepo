import { create } from "zustand";
import type {
  StoryAnimatedGifOverlay,
  StoryOverlay,
  StorySharedSource,
} from "@dvnt/app/lib/types";
import { parseStorySharedSource, SHARED_STORY_BACKDROP } from "../stories/shared-source";

/** One playable segment within a user's story group. */
export interface StoryViewerSegment {
  id?: string;
  sharedSource?: StorySharedSource;
  /** True only for a server-backed share with no source media. */
  isSourceCard?: boolean;
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

/** Both the feed rail and direct story route must preserve segment attribution. */
export function toStoryViewerGroup(s: import("../types").Story): StoryViewerGroup {
  const segments = (s.items ?? []).flatMap((item) => {
    const sharedSource = parseStorySharedSource(item.sharedSource);
    if (!item.url && !sharedSource) return [];
    return [{
      id: item.id,
      type: (item.type === "video" ? "video" : "image") as "image" | "video",
      url: item.url || SHARED_STORY_BACKDROP,
      duration: item.duration,
      storyOverlays: item.storyOverlays,
      animatedGifOverlays: item.animatedGifOverlays,
      sharedSource,
      isSourceCard: !item.url && !!sharedSource,
    }];
  });
  return {
    id: String(s.id ?? s.username),
    userId: s.userId == null ? undefined : String(s.userId),
    username: s.username,
    avatar: s.avatar,
    segments,
  };
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
