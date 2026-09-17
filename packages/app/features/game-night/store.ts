"use client";

/** Game Night room state. Zustand, per the repo's state rule — never useState. */

import { create } from "zustand";

export interface RoomPlayer {
  id: string;
  name: string | null;
  avatar: string | null;
  joinedAt: number;
}

/** "empty" is not a status: an empty roster is a CONNECTED room with one person. */
export type RoomStatus = "idle" | "connecting" | "connected" | "error";

interface GameNightState {
  players: RoomPlayer[];
  status: RoomStatus;
  joinCode: string;
  copied: boolean;
  setPlayers: (players: RoomPlayer[]) => void;
  setStatus: (status: RoomStatus) => void;
  setJoinCode: (joinCode: string) => void;
  setCopied: (copied: boolean) => void;
}

export const useGameNightStore = create<GameNightState>((set) => ({
  players: [],
  status: "idle",
  joinCode: "",
  copied: false,
  setPlayers: (players) => set({ players }),
  setStatus: (status) => set({ status }),
  setJoinCode: (joinCode) => set({ joinCode }),
  setCopied: (copied) => set({ copied }),
}));
