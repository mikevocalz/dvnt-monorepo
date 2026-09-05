/**
 * Tiny web-only UI Zustand store for the WEB Sneaky Lynk room screen.
 *
 * Room-domain state (hand-raise, eject, chat flags) lives in the SHARED
 * `useRoomStore`; this store holds ONLY the web-specific connection phase /
 * pre-join bits that have no native equivalent (the native screen used
 * `useState` for these, but the web HARD CONVENTION is Zustand — no useState).
 */

import { create } from "zustand";
import type { EjectKind } from "../ui/EjectModal.types";
import type { SneakyRoom } from "@dvnt/app/features/sneaky-lynk/types";

export type RoomPhase =
  | "prejoin"
  | "looking-up"
  | "joining"
  | "connecting"
  | "connected"
  | "closed"
  /** Web client refused a peer token because the room is app-only. Terminal
   *  on this rail — the only escape is opening the room in the DVNT app. */
  | "app-only"
  | "error";

interface RoomUIStore {
  /** Guards the join effect so it runs exactly once per mount. */
  initStarted: boolean;
  phase: RoomPhase;
  joinAnonymous: boolean;
  /** Pre-join media choices. You decide how you arrive BEFORE the room sees
   *  you — walking in already live is the thing people are afraid of. */
  joinCameraOn: boolean;
  joinMicOn: boolean;
  roomSnapshot: SneakyRoom | null;
  closedReason: string | null;
  errorMessage: string | null;
  isMicOn: boolean;
  isCameraOn: boolean;
  /**
   * The role `video_join_room` resolved for this member. State, not a ref: the
   * MoQ transport only mints a PUBLISH token for host/co-host/speaker, so
   * `canPublish` has to re-render the hook when the role lands. A ref would
   * leave a host stuck as a silent listener.
   */
  localRole: string | null;
  /**
   * OUR user id as the SERVER knows it (`video_join_room`'s user payload).
   * This is the id written to `video_room_members.user_id` and the one
   * `peerIdFor` builds the MoQ path from. The auth store's id is not the same
   * value, so every roster comparison has to use this one.
   */
  localUserId: string | null;

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
  /** Why this session ended without the user choosing it. Structured: a kick,
   *  a ban and a room simply ending are three different facts, and flattening
   *  them into one sentence is what let the web modal claim a ban was just a
   *  removal. */
  eject: { kind: EjectKind; reason?: string } | null;
  /** Seconds left before a finished room exits itself. Null when not counting. */
  ejectCountdown: number | null;
  /** The host is holding this participant muted. While true they cannot turn
   *  their own microphone on — see lib/video/host-mute. */
  hostMuteLocked: boolean;
  /** Server session deadline (video_rooms.ends_at) from the join response.
   *  `undefined` = backend predates the gate, `null` = unlimited, ISO = limited.
   *  The timer DISPLAYS this; it never decides it. */
  serverEndsAt: string | null | undefined;

  setInitStarted: (v: boolean) => void;
  setPhase: (v: RoomPhase) => void;
  setJoinAnonymous: (v: boolean) => void;
  setJoinCameraOn: (v: boolean) => void;
  setJoinMicOn: (v: boolean) => void;
  setRoomSnapshot: (v: SneakyRoom | null) => void;
  setClosed: (reason: string) => void;
  setAppOnly: () => void;
  setError: (message: string) => void;
  setMicOn: (v: boolean) => void;
  setCameraOn: (v: boolean) => void;
  setLocalRole: (v: string | null) => void;
  setLocalUserId: (v: string | null) => void;
  setParticipantsOpen: (v: boolean) => void;
  setIsPaidHost: (v: boolean) => void;
  setTimerStartedAt: (v: number) => void;
  setShowTimeUp: (v: boolean) => void;
  setEject: (v: { kind: EjectKind; reason?: string } | null) => void;
  setEjectCountdown: (v: number | null) => void;
  setHostMuteLocked: (v: boolean) => void;
  setServerEndsAt: (v: string | null) => void;
  reset: () => void;
}

const initialUIState = {
  initStarted: false,
  phase: "prejoin" as RoomPhase,
  joinAnonymous: false,
  joinCameraOn: true,
  joinMicOn: true,
  roomSnapshot: null as SneakyRoom | null,
  closedReason: null as string | null,
  errorMessage: null as string | null,
  isMicOn: false,
  isCameraOn: false,
  localRole: null as string | null,
  localUserId: null as string | null,
  isParticipantsOpen: false,
  isPaidHost: null as boolean | null,
  timerStartedAt: null as number | null,
  showTimeUp: false,
  eject: null as { kind: EjectKind; reason?: string } | null,
  ejectCountdown: null as number | null,
  hostMuteLocked: false,
  serverEndsAt: undefined as string | null | undefined,
};

export const useRoomUIStore = create<RoomUIStore>((set) => ({
  ...initialUIState,

  setInitStarted: (initStarted) => set({ initStarted }),
  setPhase: (phase) => set({ phase }),
  setJoinAnonymous: (joinAnonymous) => set({ joinAnonymous }),
  setJoinCameraOn: (joinCameraOn) => set({ joinCameraOn }),
  setJoinMicOn: (joinMicOn) => set({ joinMicOn }),
  setRoomSnapshot: (roomSnapshot) => set({ roomSnapshot }),
  setClosed: (closedReason) => set({ phase: "closed", closedReason }),
  setAppOnly: () => set({ phase: "app-only" }),
  setError: (errorMessage) => set({ phase: "error", errorMessage }),
  setMicOn: (isMicOn) => set({ isMicOn }),
  setCameraOn: (isCameraOn) => set({ isCameraOn }),
  setLocalRole: (localRole) => set({ localRole }),
  setLocalUserId: (localUserId) => set({ localUserId }),
  setParticipantsOpen: (isParticipantsOpen) => set({ isParticipantsOpen }),
  setIsPaidHost: (isPaidHost) => set({ isPaidHost }),
  setTimerStartedAt: (timerStartedAt) => set({ timerStartedAt }),
  setShowTimeUp: (showTimeUp) => set({ showTimeUp }),
  setEject: (eject) => set({ eject }),
  setEjectCountdown: (ejectCountdown) => set({ ejectCountdown }),
  setHostMuteLocked: (hostMuteLocked) => set({ hostMuteLocked }),
  setServerEndsAt: (serverEndsAt) => set({ serverEndsAt }),
  reset: () => set({ ...initialUIState }),
}));
