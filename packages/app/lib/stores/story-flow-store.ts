// ============================================================
// Story Flow State Machine (REGRESSION LOCK)
// ============================================================
// Single source of truth for story creation navigation state.
// Enforces valid transitions and prevents ghost modes.
// See: src/stories-editor/REGRESSION_LOCK.md
// ============================================================

import { create } from "zustand";

export type StoryFlowState =
  | "IDLE" // Not in story creation
  | "HUB" // story/create screen
  | "PICKER_IMAGE" // System image picker open
  | "PICKER_VIDEO" // System video picker open
  | "EDIT_IMAGE" // story/editor with image
  | "EDIT_VIDEO" // story/editor with video
  | "TEXT_ONLY" // story/editor in text-only mode
  | "SHARING"; // Upload + create in progress

// Valid transitions: from → [allowed destinations]
const VALID_TRANSITIONS: Record<StoryFlowState, StoryFlowState[]> = {
  IDLE: ["HUB"],
  HUB: [
    "IDLE",
    "PICKER_IMAGE",
    "PICKER_VIDEO",
    "EDIT_IMAGE",
    "EDIT_VIDEO",
    "TEXT_ONLY",
    "SHARING",
  ],
  PICKER_IMAGE: ["HUB"],
  PICKER_VIDEO: ["HUB"],
  EDIT_IMAGE: ["HUB"],
  EDIT_VIDEO: ["HUB"],
  TEXT_ONLY: ["HUB"],
  SHARING: ["HUB", "IDLE"],
};

interface StoryFlowStore {
  state: StoryFlowState;
  previousState: StoryFlowState;
  sessionId: string;

  // Validated transition — logs STOP-THE-LINE on invalid
  transitionTo: (next: StoryFlowState) => boolean;

  // Force reset to IDLE (used by cancel/close)
  forceIdle: () => void;
}

let _sessionCounter = 0;

export const useStoryFlowStore = create<StoryFlowStore>((set, get) => ({
  state: "IDLE",
  previousState: "IDLE",
  sessionId: `session-${++_sessionCounter}`,

  transitionTo: (next) => {
    const { state: current } = get();
    const allowed = VALID_TRANSITIONS[current];

    if (!allowed.includes(next)) {
      if (__DEV__) {
        console.error(
          `[STOP-THE-LINE] Invalid story flow transition: ${current} → ${next}`,
          `\nAllowed from ${current}:`,
          allowed.join(", "),
        );
      }
      return false;
    }

    const newSessionId =
      next === "HUB" && current === "IDLE"
        ? `session-${++_sessionCounter}`
        : get().sessionId;

    set({ state: next, previousState: current, sessionId: newSessionId });

    if (__DEV__) {
      console.log(`[StoryFlow] ${current} → ${next} (${newSessionId})`);
    }

    return true;
  },

  forceIdle: () => {
    const { state: current } = get();
    set({ state: "IDLE", previousState: current });

    if (__DEV__) {
      console.log(`[StoryFlow] FORCE IDLE (was: ${current})`);
    }
  },
}));

// ---- Derived selectors ----

export const useStoryFlowState = () =>
  useStoryFlowStore((s) => s.state);

export const useIsInEditor = () =>
  useStoryFlowStore((s) =>
    s.state === "EDIT_IMAGE" ||
    s.state === "EDIT_VIDEO" ||
    s.state === "TEXT_ONLY",
  );
