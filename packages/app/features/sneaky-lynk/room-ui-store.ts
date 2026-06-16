/**
 * Tiny web-only UI Zustand store for the WEB Sneaky Lynk room screen.
 *
 * Room-domain state (hand-raise, eject, chat flags) lives in the SHARED
 * `useRoomStore`; this store holds ONLY the web-specific connection phase /
 * pre-join bits that have no native equivalent (the native screen used
 * `useState` for these, but the web HARD CONVENTION is Zustand — no useState).
 */

import { create } from "zustand";
import type { SneakyRoom } from "@dvnt/app/src/sneaky-lynk/types";

export type RoomPhase =
  | "prejoin"
  | "looking-up"
  | "joining"
  | "connecting"
  | "connected"
  | "closed"
  | "error";

interface RoomUIStore {
  /** Guards the join effect so it runs exactly once per mount. */
  initStarted: boolean;
  phase: RoomPhase;
  joinAnonymous: boolean;
  roomSnapshot: SneakyRoom | null;
  closedReason: string | null;
  errorMessage: string | null;
  isMicOn: boolean;
  isCameraOn: boolean;

  setInitStarted: (v: boolean) => void;
  setPhase: (v: RoomPhase) => void;
  setJoinAnonymous: (v: boolean) => void;
  setRoomSnapshot: (v: SneakyRoom | null) => void;
  setClosed: (reason: string) => void;
  setError: (message: string) => void;
  setMicOn: (v: boolean) => void;
  setCameraOn: (v: boolean) => void;
  reset: () => void;
}

export const useRoomUIStore = create<RoomUIStore>((set) => ({
  initStarted: false,
  phase: "prejoin",
  joinAnonymous: false,
  roomSnapshot: null,
  closedReason: null,
  errorMessage: null,
  isMicOn: false,
  isCameraOn: false,

  setInitStarted: (initStarted) => set({ initStarted }),
  setPhase: (phase) => set({ phase }),
  setJoinAnonymous: (joinAnonymous) => set({ joinAnonymous }),
  setRoomSnapshot: (roomSnapshot) => set({ roomSnapshot }),
  setClosed: (closedReason) => set({ phase: "closed", closedReason }),
  setError: (errorMessage) => set({ phase: "error", errorMessage }),
  setMicOn: (isMicOn) => set({ isMicOn }),
  setCameraOn: (isCameraOn) => set({ isCameraOn }),
  reset: () =>
    set({
      initStarted: false,
      phase: "prejoin",
      joinAnonymous: false,
      roomSnapshot: null,
      closedReason: null,
      errorMessage: null,
      isMicOn: false,
      isCameraOn: false,
    }),
}));
