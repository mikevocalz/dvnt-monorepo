/**
 * Sneaky Lynk — capture event store.
 *
 * Tracks live "someone just captured the room" events. Per-room key so
 * state doesn't leak across rejoins. Purely client-state: not persisted,
 * not synced across devices, not stored server-side. Events are
 * broadcast-channel-delivered from the offender's device to every other
 * participant in the same room (see useSneakyLynkCaptureDetection).
 *
 * Model:
 *   currentCapture     — the most recent capture event to surface in the
 *                        room banner. Cleared after a timeout or when a
 *                        new event arrives.
 *   pulseUserIds       — set of userIds whose tile should pulse right
 *                        now (1.2s window). Used by VideoTile to render
 *                        the one-shot red pulse on the offender.
 */

import { create } from "zustand";

export type CaptureKind = "screenshot" | "recording_start" | "recording_stop";

export interface CaptureEvent {
  kind: CaptureKind;
  actorId: string;
  /**
   * Display name for the general audience. For anonymous actors this
   * is the anon label (e.g. "Anon 42") or the generic "Someone".
   * The broadcast payload NEVER carries the real username — that goes
   * to the host out-of-band via a direct chat message (see
   * `useSneakyLynkCaptureBroadcast`). Keeps the trust boundary clean.
   */
  actorUsername: string;
  /** ms-epoch when the capture was detected on the actor's device. */
  at: number;
  /** Is the actor the local user? Drives the "You took a screenshot —
   *  everyone in the room was notified" variant of the banner. */
  isSelf: boolean;
}

interface SneakyLynkCaptureState {
  currentCapture: CaptureEvent | null;
  pulseUserIds: Record<string, number>;

  /** Record an incoming capture event (from any participant, self or remote). */
  recordCapture: (event: CaptureEvent) => void;
  /** Clear the currently-displayed banner (used by UI timers + manual close). */
  clearCapture: () => void;
  /** Remove a userId from the pulse set (used by tile pulse timers). */
  clearPulse: (userId: string) => void;
  /** Reset all state (called on room leave). */
  reset: () => void;

  isPulsing: (userId: string) => boolean;
}

export const useSneakyLynkCaptureStore = create<SneakyLynkCaptureState>(
  (set, get) => ({
    currentCapture: null,
    pulseUserIds: {},

    recordCapture: (event) => {
      set((s) => ({
        currentCapture: event,
        pulseUserIds: {
          ...s.pulseUserIds,
          [event.actorId]: Date.now(),
        },
      }));
    },

    clearCapture: () => set({ currentCapture: null }),

    clearPulse: (userId) =>
      set((s) => {
        if (!(userId in s.pulseUserIds)) return s;
        const { [userId]: _removed, ...rest } = s.pulseUserIds;
        return { pulseUserIds: rest };
      }),

    reset: () => set({ currentCapture: null, pulseUserIds: {} }),

    isPulsing: (userId) => userId in get().pulseUserIds,
  }),
);
