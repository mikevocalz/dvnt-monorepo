/**
 * Lynk History Store
 * Persists Sneaky Lynk rooms locally via MMKV so ended rooms survive app restarts.
 * Auto-purges rooms older than today on rehydration — only the current day's Lynks are kept.
 */

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { storage } from "@/lib/utils/storage";
import type { SneakyUser } from "../types";

export interface LynkRecord {
  id: string;
  title: string;
  topic: string;
  description: string;
  source?: "sneaky_lynk" | "messages";
  isLive: boolean;
  hasVideo: boolean;
  isPublic: boolean;
  status: "open" | "ended";
  host: SneakyUser;
  speakers: SneakyUser[];
  listeners: number;
  maxParticipants?: number;
  createdAt: string;
  endedAt?: string;
}

interface LynkHistoryState {
  rooms: LynkRecord[];

  // Actions
  addRoom: (room: LynkRecord) => void;
  endRoom: (roomId: string, listenerCount?: number) => void;
  updateListeners: (roomId: string, count: number) => void;
  removeRoom: (roomId: string) => void;
  clearAll: () => void;
}

/** Returns true if the ISO date string is from today (local time). */
function isToday(isoString: string): boolean {
  const d = new Date(isoString);
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

export const useLynkHistoryStore = create<LynkHistoryState>()(
  persist(
    (set) => ({
      rooms: [],

      addRoom: (room) =>
        set((state) => {
          if (state.rooms.some((r) => r.id === room.id)) return state;
          return { rooms: [room, ...state.rooms] };
        }),

      endRoom: (roomId, listenerCount) =>
        set((state) => ({
          rooms: state.rooms.map((r) =>
            r.id === roomId
              ? {
                  ...r,
                  isLive: false,
                  status: "ended" as const,
                  endedAt: new Date().toISOString(),
                  listeners: listenerCount ?? r.listeners,
                }
              : r,
          ),
        })),

      updateListeners: (roomId, count) =>
        set((state) => ({
          rooms: state.rooms.map((r) =>
            r.id === roomId ? { ...r, listeners: count } : r,
          ),
        })),

      removeRoom: (roomId) =>
        set((state) => ({
          rooms: state.rooms.filter((r) => r.id !== roomId),
        })),

      clearAll: () => set({ rooms: [] }),
    }),
    {
      name: "lynk-history-storage",
      storage: createJSONStorage(() => storage),
      // On rehydration, drop any rooms older than today
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        const todayRooms = state.rooms.filter((r) => isToday(r.createdAt));
        if (todayRooms.length !== state.rooms.length) {
          // Mark stale live rooms as ended before dropping them
          useLynkHistoryStore.setState({ rooms: todayRooms });
        }
      },
    },
  ),
);
