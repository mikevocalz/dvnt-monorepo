import { create } from "zustand";
import type { StoryAnimatedGifOverlay, StoryOverlay } from "@/lib/types";

interface StoryEditorResult {
  uri: string;
  index: number;
  mediaType: "image" | "video";
  storyOverlays: StoryOverlay[];
  animatedGifOverlays: StoryAnimatedGifOverlay[];
}

interface StoryEditorResultState {
  result: StoryEditorResult | null;
  setResult: (result: StoryEditorResult) => void;
  consumeResult: () => StoryEditorResult | null;
  clear: () => void;
}

export const useStoryEditorResultStore = create<StoryEditorResultState>(
  (set, get) => ({
    result: null,
    setResult: (result) => set({ result }),
    consumeResult: () => {
      const result = get().result;
      set({ result: null });
      return result;
    },
    clear: () => set({ result: null }),
  }),
);
