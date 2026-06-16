/**
 * Presence Store
 *
 * Zustand store for tracking online/offline status of users.
 * Uses Supabase Realtime Presence for real-time updates
 * and user_presence table for persistence.
 */

import { create } from "zustand";

interface PresenceState {
  /** Map of userId -> isOnline */
  onlineUsers: Record<string, boolean>;
  /** Map of userId -> lastSeenAt ISO string */
  lastSeen: Record<string, string>;
  /** Whether the presence system is initialized */
  initialized: boolean;

  setUserOnline: (userId: string, isOnline: boolean) => void;
  setUserLastSeen: (userId: string, lastSeenAt: string) => void;
  setBulkPresence: (
    users: Array<{ userId: string; isOnline: boolean; lastSeenAt?: string }>,
  ) => void;
  isUserOnline: (userId: string) => boolean;
  reset: () => void;
  setInitialized: (v: boolean) => void;
}

export const usePresenceStore = create<PresenceState>((set, get) => ({
  onlineUsers: {},
  lastSeen: {},
  initialized: false,

  setUserOnline: (userId, isOnline) =>
    set((state) => ({
      onlineUsers: { ...state.onlineUsers, [userId]: isOnline },
      lastSeen: isOnline
        ? state.lastSeen
        : { ...state.lastSeen, [userId]: new Date().toISOString() },
    })),

  setUserLastSeen: (userId, lastSeenAt) =>
    set((state) => ({
      lastSeen: { ...state.lastSeen, [userId]: lastSeenAt },
    })),

  setBulkPresence: (users) =>
    set((state) => {
      const onlineUsers = { ...state.onlineUsers };
      const lastSeen = { ...state.lastSeen };
      for (const u of users) {
        onlineUsers[u.userId] = u.isOnline;
        if (u.lastSeenAt) lastSeen[u.userId] = u.lastSeenAt;
      }
      return { onlineUsers, lastSeen };
    }),

  isUserOnline: (userId) => get().onlineUsers[userId] ?? false,

  reset: () => set({ onlineUsers: {}, lastSeen: {}, initialized: false }),

  setInitialized: (v) => set({ initialized: v }),
}));
