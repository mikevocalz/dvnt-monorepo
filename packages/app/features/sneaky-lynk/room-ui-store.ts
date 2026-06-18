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

  /**
   * WEB-only surfaces with no native-useState equivalent. The native room
   * uses bottom-sheets (RoomParticipantsSheet) + an RN subscription paywall;
   * on web (Law 3) these become side-panels / dialogs, driven from here.
   * Chat + hand-queue open flags stay in the SHARED `useRoomStore` (parity).
   */
  isParticipantsOpen: boolean;
  /** Free host → countdown timer + duration-limit paywall. Set after the
   *  `sneaky_subscriptions` lookup; null until known. */
  isPaidHost: boolean | null;
  /** Wall-clock ms the room timer counts down from (host's connect time). */
  timerStartedAt: number | null;
  /** Free-host duration-limit dialog (mirrors the native time-up paywall). */
  showTimeUp: boolean;
  /** Pinned banner shown when the host kicks/bans the local user or ends the
   *  room (mirrors the native EjectModal). */
  ejectReason: string | null;

  setInitStarted: (v: boolean) => void;
  setPhase: (v: RoomPhase) => void;
  setJoinAnonymous: (v: boolean) => void;
  setRoomSnapshot: (v: SneakyRoom | null) => void;
  setClosed: (reason: string) => void;
  setError: (message: string) => void;
  setMicOn: (v: boolean) => void;
  setCameraOn: (v: boolean) => void;
  setParticipantsOpen: (v: boolean) => void;
  setIsPaidHost: (v: boolean) => void;
  setTimerStartedAt: (v: number) => void;
  setShowTimeUp: (v: boolean) => void;
  setEjectReason: (v: string | null) => void;
  reset: () => void;
}

const initialUIState = {
  initStarted: false,
  phase: "prejoin" as RoomPhase,
  joinAnonymous: false,
  roomSnapshot: null as SneakyRoom | null,
  closedReason: null as string | null,
  errorMessage: null as string | null,
  isMicOn: false,
  isCameraOn: false,
  isParticipantsOpen: false,
  isPaidHost: null as boolean | null,
  timerStartedAt: null as number | null,
  showTimeUp: false,
  ejectReason: null as string | null,
};

export const useRoomUIStore = create<RoomUIStore>((set) => ({
  ...initialUIState,

  setInitStarted: (initStarted) => set({ initStarted }),
  setPhase: (phase) => set({ phase }),
  setJoinAnonymous: (joinAnonymous) => set({ joinAnonymous }),
  setRoomSnapshot: (roomSnapshot) => set({ roomSnapshot }),
  setClosed: (closedReason) => set({ phase: "closed", closedReason }),
  setError: (errorMessage) => set({ phase: "error", errorMessage }),
  setMicOn: (isMicOn) => set({ isMicOn }),
  setCameraOn: (isCameraOn) => set({ isCameraOn }),
  setParticipantsOpen: (isParticipantsOpen) => set({ isParticipantsOpen }),
  setIsPaidHost: (isPaidHost) => set({ isPaidHost }),
  setTimerStartedAt: (timerStartedAt) => set({ timerStartedAt }),
  setShowTimeUp: (showTimeUp) => set({ showTimeUp }),
  setEjectReason: (ejectReason) => set({ ejectReason }),
  reset: () => set({ ...initialUIState }),
}));
