import { create } from "zustand";

/**
 * @mention UI state for the web event-comments composer. Per project rule,
 * transient input state lives in Zustand (never React useState). Tracks the
 * caret position inside the composer so the screen can derive the active
 * `@query` and offer mention suggestions.
 */
interface EventCommentMentionState {
  cursorPos: number;
  setCursorPos: (pos: number) => void;
  reset: () => void;
}

export const useEventCommentMentionStore = create<EventCommentMentionState>(
  (set) => ({
    cursorPos: 0,
    setCursorPos: (cursorPos) => set({ cursorPos }),
    reset: () => set({ cursorPos: 0 }),
  }),
);
