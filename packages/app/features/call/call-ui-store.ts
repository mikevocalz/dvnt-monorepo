/**
 * Tiny UI-only Zustand store for the WEB call screen.
 *
 * All CALL state (phase, participants, connection, mic/camera) lives in the
 * shared `useVideoRoomStore`. This store holds ONLY web-specific UI bits that
 * have no native equivalent — the one-time init guard. No `useState` anywhere
 * in the call screen (HARD CONVENTION).
 */

import { create } from "zustand";

interface CallUIStore {
  /** Guards the join effect so it runs exactly once per mount. */
  initStarted: boolean;
  setInitStarted: (v: boolean) => void;
}

export const useCallUIStore = create<CallUIStore>((set) => ({
  initStarted: false,
  setInitStarted: (initStarted) => set({ initStarted }),
}));
