"use client";

/** Live-rooms list state. Zustand, per the repo's state rule. */

import { create } from "zustand";
import type { WatchableRoom } from "./rooms-api";

/** "empty" is not a status — an empty lobby is a successful read of zero rooms. */
export type ListStatus = "loading" | "ready" | "error";

interface RoomsListState {
  rooms: WatchableRoom[];
  status: ListStatus;
  setRooms: (rooms: WatchableRoom[]) => void;
  setStatus: (next: ListStatus | ((prev: ListStatus) => ListStatus)) => void;
}

export const useRoomsListStore = create<RoomsListState>((set) => ({
  rooms: [],
  status: "loading",
  setRooms: (rooms) => set({ rooms }),
  setStatus: (next) =>
    set((s) => ({ status: typeof next === "function" ? next(s.status) : next })),
}));
