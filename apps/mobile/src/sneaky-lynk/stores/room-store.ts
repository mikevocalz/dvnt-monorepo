/**
 * Sneaky Lynk Room Store
 * Manages room state using Zustand instead of useState
 */

import { create } from "zustand";
import type { EjectPayload, SneakyUser } from "../types";

interface RoomMember {
  user: SneakyUser;
  role: "host" | "co-host" | "speaker" | "listener";
  hasVideo?: boolean;
}

interface RoomState {
  // Connection state
  connectionState: "connecting" | "connected" | "reconnecting" | "disconnected";

  // Local controls
  isMuted: boolean;
  isVideoOn: boolean;
  isHandRaised: boolean;
  raisedHands: Record<string, boolean>;
  /**
   * FIFO queue of userIds that have their hand raised, in the order
   * they raised them. Used by the host's Hand Queue Sheet so the
   * moderator sees who raised first at the top of the list — Zoom
   * parity. Stays in sync with `raisedHands` via the setRaisedHand
   * action below.
   */
  raisedHandOrder: string[];

  // Active speaker
  activeSpeakerId: string | null;

  // Co-host (optimistic — shows immediately in dual view)
  coHost: RoomMember | null;

  // Listeners (optimistic — appear instantly when they join)
  listeners: RoomMember[];

  // Chat
  isChatOpen: boolean;

  // Hand-queue moderation sheet (host-only surface)
  isHandQueueOpen: boolean;

  // Modals
  showEjectModal: boolean;
  ejectPayload: EjectPayload | null;

  // Actions
  setConnectionState: (
    state: "connecting" | "connected" | "reconnecting" | "disconnected",
  ) => void;
  setIsMuted: (muted: boolean) => void;
  toggleMute: () => void;
  setIsVideoOn: (on: boolean) => void;
  toggleVideo: () => void;
  setIsHandRaised: (raised: boolean) => void;
  setRaisedHand: (userId: string, raised: boolean) => void;
  setRaisedHands: (hands: Record<string, boolean>) => void;
  clearRaisedHands: () => void;
  toggleHand: () => void;
  setActiveSpeakerId: (id: string | null) => void;
  openChat: () => void;
  closeChat: () => void;
  openHandQueue: () => void;
  closeHandQueue: () => void;
  showEject: (payload: EjectPayload) => void;
  hideEject: () => void;

  // Co-host (optimistic)
  setCoHost: (user: SneakyUser) => void;
  removeCoHost: () => void;
  promoteListener: (userId: string) => void;

  // Listeners (optimistic)
  addListener: (user: SneakyUser) => void;
  removeListener: (userId: string) => void;

  // Reset
  reset: () => void;
}

const initialState = {
  connectionState: "connected" as const,
  isMuted: true,
  isVideoOn: false,
  isHandRaised: false,
  raisedHands: {},
  raisedHandOrder: [],
  activeSpeakerId: null,
  coHost: null as RoomMember | null,
  listeners: [] as RoomMember[],
  isChatOpen: false,
  isHandQueueOpen: false,
  showEjectModal: false,
  ejectPayload: null,
};

export const useRoomStore = create<RoomState>((set) => ({
  ...initialState,

  setConnectionState: (connectionState) => set({ connectionState }),

  setIsMuted: (isMuted) => set({ isMuted }),
  toggleMute: () => set((state) => ({ isMuted: !state.isMuted })),

  setIsVideoOn: (isVideoOn) => set({ isVideoOn }),
  toggleVideo: () => set((state) => ({ isVideoOn: !state.isVideoOn })),

  setIsHandRaised: (isHandRaised) => set({ isHandRaised }),
  setRaisedHand: (userId, raised) =>
    set((state) => {
      if (!userId) return state;
      if (!raised) {
        if (!state.raisedHands[userId]) return state;
        const nextHands = { ...state.raisedHands };
        delete nextHands[userId];
        return {
          raisedHands: nextHands,
          raisedHandOrder: state.raisedHandOrder.filter((id) => id !== userId),
        };
      }

      if (state.raisedHands[userId]) return state;
      return {
        raisedHands: { ...state.raisedHands, [userId]: true },
        // Append to the tail — oldest-raised stays first so host sees
        // the queue in FIFO order (who asked first goes first).
        raisedHandOrder: [...state.raisedHandOrder, userId],
      };
    }),
  setRaisedHands: (raisedHands) =>
    set((state) => {
      // Preserve existing order for still-raised hands; append any
      // newly-raised hands at the tail. Never reorder an already-
      // queued hand — the host's perceived order must be stable.
      const stillRaised = state.raisedHandOrder.filter((id) => raisedHands[id]);
      const newlyRaised = Object.keys(raisedHands).filter(
        (id) => raisedHands[id] && !state.raisedHands[id],
      );
      return {
        raisedHands,
        raisedHandOrder: [...stillRaised, ...newlyRaised],
      };
    }),
  clearRaisedHands: () => set({ raisedHands: {}, raisedHandOrder: [] }),
  toggleHand: () => set((state) => ({ isHandRaised: !state.isHandRaised })),

  setActiveSpeakerId: (activeSpeakerId) => set({ activeSpeakerId }),

  openChat: () => set({ isChatOpen: true }),
  closeChat: () => set({ isChatOpen: false }),

  openHandQueue: () => set({ isHandQueueOpen: true }),
  closeHandQueue: () => set({ isHandQueueOpen: false }),

  showEject: (ejectPayload) => set({ showEjectModal: true, ejectPayload }),
  hideEject: () => set({ showEjectModal: false, ejectPayload: null }),

  // Co-host — optimistic: appears in dual view immediately
  setCoHost: (user) =>
    set({ coHost: { user, role: "co-host", hasVideo: false } }),
  removeCoHost: () => set({ coHost: null }),
  promoteListener: (userId) =>
    set((state) => {
      const listener = state.listeners.find((l) => l.user.id === userId);
      if (!listener) return state;
      return {
        coHost: { user: listener.user, role: "co-host", hasVideo: false },
        listeners: state.listeners.filter((l) => l.user.id !== userId),
      };
    }),

  // Listeners — optimistic: appear in listener grid immediately
  addListener: (user) =>
    set((state) => {
      if (state.listeners.some((l) => l.user.id === user.id)) return state;
      return { listeners: [...state.listeners, { user, role: "listener" }] };
    }),
  removeListener: (userId) =>
    set((state) => ({
      listeners: state.listeners.filter((l) => l.user.id !== userId),
    })),

  reset: () => set(initialState),
}));
